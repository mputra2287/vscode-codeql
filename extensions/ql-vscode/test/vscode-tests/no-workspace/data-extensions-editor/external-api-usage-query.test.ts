import {
  readQueryResults,
  runQuery,
} from "../../../../src/data-extensions-editor/external-api-usage-query";
import { createMockLogger } from "../../../__mocks__/loggerMock";
import type { Uri } from "vscode";
import { DatabaseKind } from "../../../../src/local-databases";
import * as queryResolver from "../../../../src/contextual/queryResolver";
import { file } from "tmp-promise";
import { QueryResultType } from "../../../../src/pure/new-messages";
import { readFile } from "fs-extra";
import { load } from "js-yaml";

function createMockUri(path = "/a/b/c/foo"): Uri {
  return {
    scheme: "file",
    authority: "",
    path,
    query: "",
    fragment: "",
    fsPath: path,
    with: jest.fn(),
    toJSON: jest.fn(),
  };
}

describe("runQuery", () => {
  it("runs the query", async () => {
    jest.spyOn(queryResolver, "qlpackOfDatabase").mockResolvedValue({
      dbschemePack: "codeql/java-all",
      dbschemePackIsLibraryPack: false,
      queryPack: "codeql/java-queries",
    });

    const logPath = (await file()).path;

    const options = {
      cliServer: {
        resolveQlpacks: jest.fn().mockResolvedValue({
          "my/java-extensions": "/a/b/c/",
        }),
        resolveQueriesInSuite: jest
          .fn()
          .mockResolvedValue([
            "/home/github/codeql/java/ql/src/Telemetry/FetchExternalAPIs.ql",
          ]),
      },
      queryRunner: {
        createQueryRun: jest.fn().mockReturnValue({
          evaluate: jest.fn().mockResolvedValue({
            resultType: QueryResultType.SUCCESS,
          }),
          outputDir: {
            logPath,
          },
        }),
        logger: createMockLogger(),
      },
      logger: createMockLogger(),
      databaseItem: {
        databaseUri: createMockUri("/a/b/c/src.zip"),
        contents: {
          kind: DatabaseKind.Database,
          name: "foo",
          datasetUri: createMockUri(),
        },
        language: "java",
      },
      queryStorageDir: "/tmp/queries",
      progress: jest.fn(),
      token: {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(),
      },
    };
    const result = await runQuery(options);

    expect(result?.resultType).toEqual(QueryResultType.SUCCESS);

    expect(options.cliServer.resolveQueriesInSuite).toHaveBeenCalledWith(
      expect.anything(),
      [],
    );
    const suiteFile = options.cliServer.resolveQueriesInSuite.mock.calls[0][0];
    const suiteFileContents = await readFile(suiteFile, "utf8");
    const suiteYaml = load(suiteFileContents);
    expect(suiteYaml).toEqual([
      {
        from: "codeql/java-all",
        queries: ".",
        include: {
          id: "java/telemetry/fetch-external-apis",
        },
      },
      {
        from: "codeql/java-queries",
        queries: ".",
        include: {
          id: "java/telemetry/fetch-external-apis",
        },
      },
    ]);

    expect(options.cliServer.resolveQlpacks).toHaveBeenCalledTimes(1);
    expect(options.cliServer.resolveQlpacks).toHaveBeenCalledWith([], true);
    expect(options.queryRunner.createQueryRun).toHaveBeenCalledWith(
      "/a/b/c/src.zip",
      {
        queryPath:
          "/home/github/codeql/java/ql/src/Telemetry/FetchExternalAPIs.ql",
        quickEvalPosition: undefined,
      },
      false,
      [],
      ["my/java-extensions"],
      "/tmp/queries",
      undefined,
      undefined,
    );
  });
});

describe("readQueryResults", () => {
  const options = {
    cliServer: {
      bqrsInfo: jest.fn(),
      bqrsDecode: jest.fn(),
    },
    bqrsPath: "/tmp/results.bqrs",
    logger: createMockLogger(),
  };

  it("returns undefined when there are no results", async () => {
    options.cliServer.bqrsInfo.mockResolvedValue({
      "result-sets": [],
    });

    expect(await readQueryResults(options)).toBeUndefined();
    expect(options.logger.log).toHaveBeenCalledWith(
      expect.stringMatching(/Expected exactly one result set/),
    );
  });

  it("returns undefined when there are multiple result sets", async () => {
    options.cliServer.bqrsInfo.mockResolvedValue({
      "result-sets": [
        {
          name: "#select",
          rows: 10,
          columns: [
            { name: "apiName", kind: "s" },
            { name: "supported", kind: "b" },
            { name: "usage", kind: "e" },
          ],
        },
        {
          name: "#select2",
          rows: 10,
          columns: [
            { name: "apiName", kind: "s" },
            { name: "supported", kind: "b" },
            { name: "usage", kind: "e" },
          ],
        },
      ],
    });

    expect(await readQueryResults(options)).toBeUndefined();
    expect(options.logger.log).toHaveBeenCalledWith(
      expect.stringMatching(/Expected exactly one result set/),
    );
  });

  it("gets the result set", async () => {
    options.cliServer.bqrsInfo.mockResolvedValue({
      "result-sets": [
        {
          name: "#select",
          rows: 10,
          columns: [
            { name: "apiName", kind: "s" },
            { name: "supported", kind: "b" },
            { name: "usage", kind: "e" },
          ],
        },
      ],
      "compatible-query-kinds": ["Table", "Tree", "Graph"],
    });
    const decodedResultSet = {
      columns: [
        { name: "apiName", kind: "String" },
        { name: "supported", kind: "Boolean" },
        { name: "usage", kind: "Entity" },
      ],
      tuples: [
        [
          "java.io.PrintStream#println(String)",
          true,
          {
            label: "println(...)",
            url: {
              uri: "file:/home/runner/work/sql2o-example/sql2o-example/src/main/java/org/example/HelloController.java",
              startLine: 29,
              startColumn: 9,
              endLine: 29,
              endColumn: 49,
            },
          },
        ],
      ],
    };
    options.cliServer.bqrsDecode.mockResolvedValue(decodedResultSet);

    const result = await readQueryResults(options);
    expect(result).toEqual(decodedResultSet);
    expect(options.cliServer.bqrsInfo).toHaveBeenCalledWith(options.bqrsPath);
    expect(options.cliServer.bqrsDecode).toHaveBeenCalledWith(
      options.bqrsPath,
      "#select",
    );
  });
});
