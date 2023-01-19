// @generated by protoc-gen-es v1.0.0 with parameter "target=ts"
// @generated from file remote-repository-schema.proto (package docs, syntax proto3)
/* eslint-disable */
// @ts-nocheck

import type {
  BinaryReadOptions,
  FieldList,
  JsonReadOptions,
  JsonValue,
  PartialMessage,
  PlainMessage,
} from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";

/**
 * @generated from message docs.RemoteRepositorySchema
 */
export class RemoteRepositorySchema extends Message<RemoteRepositorySchema> {
  /**
   * @generated from field: string owner = 1;
   */
  owner = "";

  /**
   * @generated from field: string name = 2;
   */
  name = "";

  constructor(data?: PartialMessage<RemoteRepositorySchema>) {
    super();
    proto3.util.initPartial(data, this);
  }

  static readonly runtime = proto3;
  static readonly typeName = "docs.RemoteRepositorySchema";
  static readonly fields: FieldList = proto3.util.newFieldList(() => [
    { no: 1, name: "owner", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    { no: 2, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
  ]);

  static fromBinary(
    bytes: Uint8Array,
    options?: Partial<BinaryReadOptions>,
  ): RemoteRepositorySchema {
    return new RemoteRepositorySchema().fromBinary(bytes, options);
  }

  static fromJson(
    jsonValue: JsonValue,
    options?: Partial<JsonReadOptions>,
  ): RemoteRepositorySchema {
    return new RemoteRepositorySchema().fromJson(jsonValue, options);
  }

  static fromJsonString(
    jsonString: string,
    options?: Partial<JsonReadOptions>,
  ): RemoteRepositorySchema {
    return new RemoteRepositorySchema().fromJsonString(jsonString, options);
  }

  static equals(
    a:
      | RemoteRepositorySchema
      | PlainMessage<RemoteRepositorySchema>
      | undefined,
    b:
      | RemoteRepositorySchema
      | PlainMessage<RemoteRepositorySchema>
      | undefined,
  ): boolean {
    return proto3.util.equals(RemoteRepositorySchema, a, b);
  }
}