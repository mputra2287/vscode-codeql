import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import * as tmp from 'tmp';
import * as fs from 'fs-extra';
import * as path from 'path';
import { CancellationToken, ExtensionContext, Uri, workspace } from 'vscode';

import {
  DatabaseEventKind,
  DatabaseManager,
  DatabaseItemImpl,
  DatabaseContents,
  FullDatabaseOptions,
  findSourceArchive
} from '../../databases';
import { Logger } from '../../logging';
import { ProgressCallback } from '../../commandRunner';
import { CodeQLCliServer, DbInfo } from '../../cli';
import { encodeArchiveBasePath, encodeSourceArchiveUri } from '../../archive-filesystem-provider';
import { testDisposeHandler } from '../test-dispose-handler';
import { QueryRunner } from '../../queryRunner';

describe('databases', () => {

  const MOCK_DB_OPTIONS: FullDatabaseOptions = {
    dateAdded: 123,
    ignoreSourceArchive: false,
    language: ''
  };

  let databaseManager: DatabaseManager;
  const updateSpy = jest.fn();
  const registerSpy = jest.fn();
  const deregisterSpy = jest.fn();
  const supportsLanguageNameSpy = jest.fn<() => Promise<boolean>>();
  const resolveDatabaseSpy = jest.fn<(databasePath: string) => Promise<DbInfo>>();

  let dir: tmp.DirResult;

  beforeEach(() => {
    dir = tmp.dirSync();

    updateSpy.mockReset();
    registerSpy.mockReset();
    deregisterSpy.mockReset();
    supportsLanguageNameSpy.mockReset();

    databaseManager = new DatabaseManager(
      {
        workspaceState: {
          update: updateSpy,
          get: () => [],
        },
        // pretend like databases added in the temp dir are controlled by the extension
        // so that they are deleted upon removal
        storagePath: dir.name
      } as unknown as ExtensionContext,
      {
        registerDatabase: registerSpy,
        deregisterDatabase: deregisterSpy,
        onStart: () => { /**/ }
      } as unknown as QueryRunner,
      {
        cliConstraints: {
          supportsLanguageName: supportsLanguageNameSpy,
          supportsDatabaseRegistration: () => true,
        },
        resolveDatabase: resolveDatabaseSpy
      } as unknown as CodeQLCliServer,
      {
        log: () => { /**/ }
      } as unknown as Logger,
    );

    // Unfortunately, during a test it is not possible to convert from
    // a single root workspace to multi-root, so must stub out relevant
    // functions
    jest.spyOn(workspace, 'updateWorkspaceFolders').mockImplementation(() => true);
  });

  afterEach(async () => {
    dir.removeCallback();
    databaseManager.dispose(testDisposeHandler);
  });

  it('should fire events when adding and removing a db item', async () => {
    const mockDbItem = createMockDB();
    const onDidChangeDatabaseItem = jest.fn();
    databaseManager.onDidChangeDatabaseItem(onDidChangeDatabaseItem);
    await (databaseManager as any).addDatabaseItem(
      {} as ProgressCallback,
      {} as CancellationToken,
      mockDbItem
    );

    expect((databaseManager as any)._databaseItems).toEqual([mockDbItem]);
    expect(updateSpy).toHaveBeenCalledWith('databaseList', [{
      options: MOCK_DB_OPTIONS,
      uri: dbLocationUri().toString(true)
    }]);
    expect(onDidChangeDatabaseItem).toHaveBeenCalledWith({
      item: undefined,
      kind: DatabaseEventKind.Add
    });

    // now remove the item
    await databaseManager.removeDatabaseItem(
      {} as ProgressCallback,
      {} as CancellationToken,
      mockDbItem,
    );
    expect((databaseManager as any)._databaseItems).toEqual([]);
    expect(updateSpy).toHaveBeenCalledWith('databaseList', []);
    expect(onDidChangeDatabaseItem).toHaveBeenCalledWith({
      item: undefined,
      kind: DatabaseEventKind.Remove
    });
  });

  it('should rename a db item and emit an event', async () => {
    const mockDbItem = createMockDB();
    const onDidChangeDatabaseItem = jest.fn();
    databaseManager.onDidChangeDatabaseItem(onDidChangeDatabaseItem);
    await (databaseManager as any).addDatabaseItem(
      {} as ProgressCallback,
      {} as CancellationToken,
      mockDbItem
    );

    await databaseManager.renameDatabaseItem(mockDbItem, 'new name');

    expect(mockDbItem.name).toEqual('new name');
    expect(updateSpy).toHaveBeenCalledWith('databaseList', [{
      options: { ...MOCK_DB_OPTIONS, displayName: 'new name' },
      uri: dbLocationUri().toString(true)
    }]);

    expect(onDidChangeDatabaseItem).toHaveBeenCalledWith({
      item: undefined,
      kind: DatabaseEventKind.Rename
    });
  });

  describe('add / remove database items', () => {
    it('should add a database item', async () => {
      const onDidChangeDatabaseItem = jest.fn();
      databaseManager.onDidChangeDatabaseItem(onDidChangeDatabaseItem);
      const mockDbItem = createMockDB();

      await (databaseManager as any).addDatabaseItem(
        {} as ProgressCallback,
        {} as CancellationToken,
        mockDbItem
      );

      expect(databaseManager.databaseItems).toEqual([mockDbItem]);
      expect(updateSpy).toHaveBeenCalledWith('databaseList', [{
        uri: dbLocationUri().toString(true),
        options: MOCK_DB_OPTIONS
      }]);

      const mockEvent = {
        item: undefined,
        kind: DatabaseEventKind.Add
      };
      expect(onDidChangeDatabaseItem).toHaveBeenCalledWith(mockEvent);
    });

    it('should add a database item source archive', async function() {
      const mockDbItem = createMockDB();
      mockDbItem.name = 'xxx';
      await (databaseManager as any).addDatabaseSourceArchiveFolder(mockDbItem);

      // workspace folders should be updated. We can only check the mocks since
      // when running as a test, we are not allowed to update the workspace folders
      expect(workspace.updateWorkspaceFolders).toHaveBeenCalledWith(1, 0, {
        name: '[xxx source archive]',
        // must use a matcher here since vscode URIs with the same path
        // are not always equal due to internal state.
        uri: expect.objectContaining({
          fsPath: encodeArchiveBasePath(sourceLocationUri().fsPath).fsPath,
        })
      });
    });

    it('should remove a database item', async () => {
      const mockDbItem = createMockDB();
      const removeMock = jest.spyOn(fs, 'remove');
      removeMock.mockImplementation(() => Promise.resolve());

      // pretend that this item is the first workspace folder in the list
      jest.spyOn(mockDbItem, 'belongsToSourceArchiveExplorerUri').mockReturnValue(true);

      await (databaseManager as any).addDatabaseItem(
        {} as ProgressCallback,
        {} as CancellationToken,
        mockDbItem
      );

      updateSpy.mockClear();

      await databaseManager.removeDatabaseItem(
        {} as ProgressCallback,
        {} as CancellationToken,
        mockDbItem
      );

      expect(databaseManager.databaseItems).toEqual([]);
      expect(updateSpy).toHaveBeenCalledWith('databaseList', []);
      // should remove the folder
      expect(workspace.updateWorkspaceFolders).toHaveBeenCalledWith(0, 1);

      // should also delete the db contents
      expect(removeMock).toHaveBeenCalledWith(mockDbItem.databaseUri.fsPath);
    });

    it('should remove a database item outside of the extension controlled area', async () => {
      const mockDbItem = createMockDB();
      const removeMock = jest.spyOn(fs, 'remove');
      removeMock.mockImplementation(() => Promise.resolve());

      // pretend that this item is the first workspace folder in the list
      jest.spyOn(mockDbItem, 'belongsToSourceArchiveExplorerUri').mockReturnValue(true);

      await (databaseManager as any).addDatabaseItem(
        {} as ProgressCallback,
        {} as CancellationToken,
        mockDbItem
      );
      updateSpy.mockClear();

      // pretend that the database location is not controlled by the extension
      (databaseManager as any).ctx.storagePath = 'hucairz';

      await databaseManager.removeDatabaseItem(
        {} as ProgressCallback,
        {} as CancellationToken,
        mockDbItem
      );

      expect(databaseManager.databaseItems).toEqual([]);
      expect(updateSpy).toHaveBeenCalledWith('databaseList', []);
      // should remove the folder
      expect(workspace.updateWorkspaceFolders).toHaveBeenCalledWith(0, 1);

      // should NOT delete the db contents
      expect(removeMock).not.toHaveBeenCalled();
    });

    it('should register and deregister a database when adding and removing it', async () => {
      // similar test as above, but also check the call to sendRequestSpy to make sure they send the
      // registration messages.
      const mockDbItem = createMockDB();

      jest.spyOn(fs, 'remove').mockImplementation(() => Promise.resolve());

      await (databaseManager as any).addDatabaseItem(
        {} as ProgressCallback,
        {} as CancellationToken,
        mockDbItem
      );
      // Should have registered this database
      expect(registerSpy).toHaveBeenCalledWith({}, {}, mockDbItem);

      await databaseManager.removeDatabaseItem(
        {} as ProgressCallback,
        {} as CancellationToken,
        mockDbItem
      );

      // Should have deregistered this database
      expect(deregisterSpy).toHaveBeenCalledWith({}, {}, mockDbItem);
    });
  });

  describe('resolveSourceFile', () => {
    it('should fail to resolve when not a uri', () => {
      const db = createMockDB(Uri.parse('file:/sourceArchive-uri/'));
      (db as any)._contents.sourceArchiveUri = undefined;
      expect(() => db.resolveSourceFile('abc')).toThrow('Scheme is missing');
    });

    it('should fail to resolve when not a file uri', () => {
      const db = createMockDB(Uri.parse('file:/sourceArchive-uri/'));
      (db as any)._contents.sourceArchiveUri = undefined;
      expect(() => db.resolveSourceFile('http://abc')).toThrow('Invalid uri scheme');
    });

    describe('no source archive', () => {
      it('should resolve undefined', () => {
        const db = createMockDB(Uri.parse('file:/sourceArchive-uri/'));
        (db as any)._contents.sourceArchiveUri = undefined;
        const resolved = db.resolveSourceFile(undefined);
        expect(resolved.toString(true)).toEqual(dbLocationUri().toString(true));
      });

      it('should resolve an empty file', () => {
        const db = createMockDB(Uri.parse('file:/sourceArchive-uri/'));
        (db as any)._contents.sourceArchiveUri = undefined;
        const resolved = db.resolveSourceFile('file:');
        expect(resolved.toString()).toEqual('file:///');
      });
    });

    describe('zipped source archive', () => {
      it('should encode a source archive url', () => {
        const db = createMockDB(encodeSourceArchiveUri({
          sourceArchiveZipPath: 'sourceArchive-uri',
          pathWithinSourceArchive: 'def'
        }));
        const resolved = db.resolveSourceFile(Uri.file('abc').toString());

        // must recreate an encoded archive uri instead of typing out the
        // text since the uris will be different on windows and ubuntu.
        expect(resolved.toString()).toEqual(encodeSourceArchiveUri({
          sourceArchiveZipPath: 'sourceArchive-uri',
          pathWithinSourceArchive: 'def/abc'
        }).toString());
      });

      it('should encode a source archive url with trailing slash', () => {
        const db = createMockDB(encodeSourceArchiveUri({
          sourceArchiveZipPath: 'sourceArchive-uri',
          pathWithinSourceArchive: 'def/'
        }));
        const resolved = db.resolveSourceFile(Uri.file('abc').toString());

        // must recreate an encoded archive uri instead of typing out the
        // text since the uris will be different on windows and ubuntu.
        expect(resolved.toString()).toEqual(encodeSourceArchiveUri({
          sourceArchiveZipPath: 'sourceArchive-uri',
          pathWithinSourceArchive: 'def/abc'
        }).toString());
      });

      it('should encode an empty source archive url', () => {
        const db = createMockDB(encodeSourceArchiveUri({
          sourceArchiveZipPath: 'sourceArchive-uri',
          pathWithinSourceArchive: 'def'
        }));
        const resolved = db.resolveSourceFile('file:');
        expect(resolved.toString()).toEqual('codeql-zip-archive://1-18/sourceArchive-uri/def/');
      });
    });

    it('should handle an empty file', () => {
      const db = createMockDB(Uri.parse('file:/sourceArchive-uri/'));
      const resolved = db.resolveSourceFile('');
      expect(resolved.toString()).toEqual('file:///sourceArchive-uri/');
    });
  });

  it('should not support the primary language', async () => {
    supportsLanguageNameSpy.mockResolvedValue(false);

    const result = (await (databaseManager as any).getPrimaryLanguage('hucairz'));
    expect(result).toBeUndefined();
  });

  it('should get the primary language', async () => {
    supportsLanguageNameSpy.mockResolvedValue(true);
    resolveDatabaseSpy.mockResolvedValue({
      languages: ['python']
    } as unknown as DbInfo);
    const result = (await (databaseManager as any).getPrimaryLanguage('hucairz'));
    expect(result).toEqual('python');
  });

  it('should handle missing the primary language', async () => {
    supportsLanguageNameSpy.mockResolvedValue(true);
    resolveDatabaseSpy.mockResolvedValue({
      languages: []
    } as unknown as DbInfo);
    const result = (await (databaseManager as any).getPrimaryLanguage('hucairz'));
    expect(result).toEqual('');
  });

  describe('isAffectedByTest', () => {
    const directoryStats = new fs.Stats();
    const fileStats = new fs.Stats();

    jest.spyOn(directoryStats, 'isDirectory').mockReturnValue(true);
    jest.spyOn(fileStats, 'isDirectory').mockReturnValue(false);

    it('should return true for testproj database in test directory', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue(directoryStats);
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.testproj'));
      expect(await db.isAffectedByTest('/path/to/dir')).toBeTruthy;
    });

    it('should return false for non-existent test directory', async () => {
      jest.spyOn(fs, 'stat').mockImplementation(() => {
        throw new Error('Simulated Error: ENOENT');
      });
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.testproj'));
      expect(await db.isAffectedByTest('/path/to/dir')).toBeFalsy();
    });

    it('should return false for non-testproj database in test directory', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue(directoryStats);
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.proj'));
      expect(await db.isAffectedByTest('/path/to/dir')).toBeFalsy;
    });

    it('should return false for testproj database outside test directory', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue(directoryStats);
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/other/dir.testproj'));
      expect(await db.isAffectedByTest('/path/to/dir')).toBeFalsy;
    });

    it('should return false for testproj database for prefix directory', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue(directoryStats);
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.testproj'));
      // /path/to/d is a prefix of /path/to/dir/dir.testproj, but
      // /path/to/dir/dir.testproj is not under /path/to/d
      expect(await db.isAffectedByTest('/path/to/d')).toBeFalsy;
    });

    it('should return true for testproj database for test file', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue(fileStats);
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.testproj'));
      expect(await db.isAffectedByTest('/path/to/dir/test.ql')).toBeTruthy;
    });

    it('should return false for non-existent test file', async () => {
      jest.spyOn(fs, 'stat').mockImplementation(() => {
        throw new Error('Simulated Error: ENOENT');
      });
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.testproj'));
      expect(await db.isAffectedByTest('/path/to/dir/test.ql')).toBeFalsy;
    });

    it('should return false for non-testproj database for test file', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue(fileStats);
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.proj'));
      expect(await db.isAffectedByTest('/path/to/dir/test.ql')).toBeFalsy;
    });

    it('should return false for testproj database not matching test file', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue(fileStats);
      const db = createMockDB(sourceLocationUri(), Uri.file('/path/to/dir/dir.testproj'));
      expect(await db.isAffectedByTest('/path/to/test.ql')).toBeFalsy;
    });

  });

  describe('findSourceArchive', function() {
    ['src', 'output/src_archive'].forEach(name => {
      it(`should find source folder in ${name}`, async () => {
        const uri = Uri.file(path.join(dir.name, name));
        fs.createFileSync(path.join(uri.fsPath, 'hucairz.txt'));
        const srcUri = await findSourceArchive(dir.name);
        expect(srcUri!.fsPath).toEqual(uri.fsPath);
      });

      it(`should find source archive in ${name}.zip`, async () => {
        const uri = Uri.file(path.join(dir.name, name + '.zip'));
        fs.createFileSync(uri.fsPath);
        const srcUri = await findSourceArchive(dir.name);
        expect(srcUri!.fsPath).toEqual(uri.fsPath);
      });

      it(`should prioritize ${name}.zip over ${name}`, async () => {
        const uri = Uri.file(path.join(dir.name, name + '.zip'));
        fs.createFileSync(uri.fsPath);

        const uriFolder = Uri.file(path.join(dir.name, name));
        fs.createFileSync(path.join(uriFolder.fsPath, 'hucairz.txt'));

        const srcUri = await findSourceArchive(dir.name);
        expect(srcUri!.fsPath).toEqual(uri.fsPath);
      });
    });

    it('should prioritize src over output/src_archive', async () => {
      const uriSrc = Uri.file(path.join(dir.name, 'src.zip'));
      fs.createFileSync(uriSrc.fsPath);
      const uriSrcArchive = Uri.file(path.join(dir.name, 'src.zip'));
      fs.createFileSync(uriSrcArchive.fsPath);

      const resultUri = await findSourceArchive(dir.name);
      expect(resultUri!.fsPath).toEqual(uriSrc.fsPath);
    });
  });

  function createMockDB(
    // source archive location must be a real(-ish) location since
    // tests will add this to the workspace location
    sourceArchiveUri = sourceLocationUri(),
    databaseUri = dbLocationUri()
  ): DatabaseItemImpl {

    return new DatabaseItemImpl(
      databaseUri,
      {
        sourceArchiveUri,
        datasetUri: databaseUri
      } as DatabaseContents,
      MOCK_DB_OPTIONS,
      () => void 0,
    );
  }

  function sourceLocationUri() {
    return Uri.file(path.join(dir.name, 'src.zip'));
  }

  function dbLocationUri() {
    return Uri.file(path.join(dir.name, 'db'));
  }
});
