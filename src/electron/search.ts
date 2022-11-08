/*
 * Copyright 2021 Google LLC
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

import {
  ModelDef,
  Runtime,
  SearchIndexResult,
  StructDef,
} from "@malloydata/malloy";
import { CONNECTION_MANAGER } from "./connections";
import { URL_READER } from "./urls";

export async function searchIndex(
  model: ModelDef,
  source: StructDef,
  modelPath: string,
  searchTerm: string,
  fieldPath?: string
): Promise<SearchIndexResult[] | undefined> {
  const sourceName = source.as || source.name;
  const connections = CONNECTION_MANAGER.getConnectionLookup(
    new URL("file://" + modelPath)
  );
  const runtime = new Runtime(URL_READER, connections);
  const contents = { ...model.contents, [sourceName]: source };
  return runtime
    ._loadModelFromModelDef({
      ...model,
      contents,
    })
    .search(sourceName, searchTerm, undefined, fieldPath);
}
