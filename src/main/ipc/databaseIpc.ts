import { ipcMain } from "electron";
import {
  createRecord,
  deleteRecord,
  getDatabaseStatus,
  getRecord,
  getSetting,
  listRecords,
  resetLocalData,
  setSetting,
  updateRecord,
  DatabaseOperationError
} from "../database";
import type {
  CrudTableName,
  DatabaseApiErrorPayload,
  DatabaseRecordInput,
  DatabaseRecordUpdate,
  DatabaseResult,
  ListRecordsOptions
} from "../../shared/types";

const databaseChannels = [
  "database:getStatus",
  "database:listRecords",
  "database:getRecord",
  "database:createRecord",
  "database:updateRecord",
  "database:deleteRecord",
  "database:resetLocalData",
  "database:getSetting",
  "database:setSetting"
] as const;

export function registerDatabaseIpc(): void {
  for (const channel of databaseChannels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle("database:getStatus", () =>
    handleDatabaseOperation(() => getDatabaseStatus())
  );

  ipcMain.handle(
    "database:listRecords",
    (_event, tableName: CrudTableName, options?: ListRecordsOptions) =>
      handleDatabaseOperation(() => listRecords(tableName, options))
  );

  ipcMain.handle(
    "database:getRecord",
    (_event, tableName: CrudTableName, id: string) =>
      handleDatabaseOperation(() => getRecord(tableName, id))
  );

  ipcMain.handle(
    "database:createRecord",
    (_event, tableName: CrudTableName, data: DatabaseRecordInput) =>
      handleDatabaseOperation(() => createRecord(tableName, data))
  );

  ipcMain.handle(
    "database:updateRecord",
    (
      _event,
      tableName: CrudTableName,
      id: string,
      data: DatabaseRecordUpdate
    ) => handleDatabaseOperation(() => updateRecord(tableName, id, data))
  );

  ipcMain.handle(
    "database:deleteRecord",
    (_event, tableName: CrudTableName, id: string) =>
      handleDatabaseOperation(() => deleteRecord(tableName, id))
  );

  ipcMain.handle("database:resetLocalData", () =>
    handleDatabaseOperation(() => resetLocalData())
  );

  ipcMain.handle("database:getSetting", (_event, key: string) =>
    handleDatabaseOperation(() => getSetting(key))
  );

  ipcMain.handle("database:setSetting", (_event, key: string, value: string) =>
    handleDatabaseOperation(() => setSetting(key, value))
  );
}

function handleDatabaseOperation<T>(operation: () => T): DatabaseResult<T> {
  try {
    return {
      ok: true,
      data: operation()
    };
  } catch (error) {
    console.error("Database IPC operation failed:", error);

    return {
      ok: false,
      error: serializeDatabaseError(error)
    };
  }
}

function serializeDatabaseError(error: unknown): DatabaseApiErrorPayload {
  if (error instanceof DatabaseOperationError) {
    return {
      code: error.code,
      message: getErrorMessage(error.cause) || error.message
    };
  }

  return {
    code: "DATABASE_UNKNOWN_ERROR",
    message: getErrorMessage(error) || "An unknown database error occurred."
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}
