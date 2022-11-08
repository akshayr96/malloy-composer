/*
 * Copyright 2022 Google LLC
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * version 2 as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 */

import { DuckDBWASMConnection } from "@malloydata/db-duckdb/dist/duckdb_wasm_connection";
import * as malloy from "@malloydata/malloy";
import * as explore from "../../types";

export class DuckDBWasmLookup
  implements malloy.LookupConnection<DuckDBWASMConnection>
{
  connection: DuckDBWASMConnection;

  constructor() {
    this.connection = new DuckDBWASMConnection("duckdb");
  }

  async lookupConnection(_name: string): Promise<DuckDBWASMConnection> {
    await this.connection.connecting;
    return this.connection;
  }
}

export const fetchFile = async (url: URL): Promise<string> => {
  const body = await fetch(url);
  return body.text();
};

export class BrowserURLReader implements malloy.URLReader {
  private contents: Record<string, string> = {};

  setContents(url: string, value: string): void {
    this.contents[url] = value;
  }

  async readURL(url: URL): Promise<string> {
    const key = url.toString();
    if (key in this.contents) {
      return this.contents[key];
    } else {
      return fetchFile(url);
    }
  }
}

const URL_READER = new BrowserURLReader();
const DUCKDB_WASM = new DuckDBWasmLookup();
const RUNTIME = new malloy.Runtime(URL_READER, DUCKDB_WASM);

interface SampleEntry {
  name: string;
  description: string;
  tables: string[];
  model: string;
  readme?: string;
  styles?: string;
}

export async function datasets(): Promise<explore.Dataset[]> {
  const base = window.location.href;
  const samplesURL = new URL("composer.json", base);
  const response = await URL_READER.readURL(samplesURL);
  const samples = JSON.parse(response) as { datasets: SampleEntry[] };
  return await Promise.all(
    samples.datasets.map(async (sample: SampleEntry) => {
      const connection = await DUCKDB_WASM.lookupConnection("duckdb");
      await Promise.all(
        sample.tables.map((tableName) => {
          return connection.database?.registerFileURL(
            tableName,
            new URL(tableName, base).toString()
          );
        })
      );
      const modelURL = new URL(sample.model, base);
      // const malloy = await URL_READER.readURL(modelURL);
      const readme =
        sample.readme &&
        (await URL_READER.readURL(new URL(sample.readme, base)));
      const styles =
        sample.styles &&
        (await URL_READER.readURL(new URL(sample.styles, base)));
      const model = await RUNTIME.getModel(modelURL);
      return {
        id: modelURL.toString(),
        name: sample.name,
        description: sample.description,
        model: model._modelDef,
        readme,
        styles,
      };
    })
  );
}

export async function runQuery(
  query: string,
  queryName: string,
  model: malloy.ModelDef
): Promise<Error | malloy.Result> {
  const baseModel = await RUNTIME._loadModelFromModelDef(model).getModel();
  const queryModel = await malloy.Malloy.compile({
    urlReader: URL_READER,
    connections: DUCKDB_WASM,
    model: baseModel,
    parse: malloy.Malloy.parse({ source: query }),
  });
  const runnable = RUNTIME._loadModelFromModelDef(
    queryModel._modelDef
  ).loadQueryByName(queryName);
  const rowLimit = (await runnable.getPreparedResult()).resultExplore.limit;
  return runnable.run({ rowLimit });
}

function mapField(
  field: malloy.Field,
  path: string | undefined
): explore.SchemaField {
  const newPath = path !== undefined ? `${path}.${field.name}` : field.name;
  if (field.isExploreField()) {
    return {
      name: field.name,
      path: newPath,
      type: "source",
      kind: "source",
      fields: field.allFields.map((field) => mapField(field, newPath)),
    };
  } else if (field.isQueryField()) {
    return {
      name: field.name,
      path: newPath,
      type: "query",
      kind: "query",
    };
  } else {
    const kind = field.isAggregate() ? "measure" : "dimension";
    return {
      name: field.name,
      path: newPath,
      type: field.type,
      kind,
    };
  }
}

export async function schema(
  model: string,
  sourceName: string
): Promise<
  | Error
  | {
      schema: explore.Schema;
      modelDef: malloy.ModelDef;
      malloy: string;
    }
> {
  const compiledModel = await RUNTIME.getModel(model);
  const source = compiledModel.explores.find(
    (source) => source.name === sourceName
  );
  if (source === undefined) {
    throw new Error(`No source with name ${sourceName}`);
  }
  return {
    schema: {
      fields: source.allFields.map((field) => mapField(field, undefined)),
    },
    modelDef: compiledModel._modelDef,
    malloy: model,
  };
}

export async function search(
  model: malloy.ModelDef,
  source: malloy.StructDef,
  searchTerm: string,
  fieldPath?: string
): Promise<malloy.SearchIndexResult[] | undefined | Error> {
  console.log("search", { model, source, searchTerm, fieldPath });
  const sourceName = source.as || source.name;
  const contents = { ...model.contents, [sourceName]: source };
  console.log(model, {
    ...model,
    contents,
  });
  return RUNTIME._loadModelFromModelDef({
    ...model,
    contents,
  }).search(sourceName, searchTerm, undefined, fieldPath);
}

export async function topValues(
  model: malloy.ModelDef,
  source: malloy.StructDef
): Promise<malloy.SearchValueMapResult[] | undefined> {
  console.log("topValues", { model, source });
  const sourceName = source.as || source.name;
  const contents = { ...model.contents, [sourceName]: source };
  return RUNTIME._loadModelFromModelDef({
    ...model,
    contents,
  }).searchValueMap(sourceName);
}
