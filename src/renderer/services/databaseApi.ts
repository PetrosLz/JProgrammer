import type {
  CrudTableName,
  DatabaseEntityMap,
  DatabaseRecordInput,
  DatabaseRecordUpdate,
  DatabaseResult,
  DatabaseStatus,
  DeleteScheduleRunGraphRequest,
  DeleteScheduleRunGraphResult,
  ListRecordsOptions,
  PersistCompleteGeneratedScheduleRequest,
  PersistCompleteGeneratedScheduleResult,
  PersistManualAssignmentChangeRequest,
  PersistManualAssignmentChangeResult,
  PersistValidatedScheduleBatchRequest,
  PersistValidatedScheduleBatchResult,
  SettingRecord
} from "../../shared/types";

export class DatabaseApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DatabaseApiError";
    this.code = code;
  }
}

export const databaseApi = {
  getStatus: async (): Promise<DatabaseStatus> =>
    unwrap(await window.jprogrammer.database.getStatus()),

  listRecords: async <T extends CrudTableName>(
    tableName: T,
    options?: ListRecordsOptions
  ): Promise<DatabaseEntityMap[T][]> =>
    unwrap(await window.jprogrammer.database.listRecords(tableName, options)),

  getRecord: async <T extends CrudTableName>(
    tableName: T,
    id: string
  ): Promise<DatabaseEntityMap[T] | null> =>
    unwrap(await window.jprogrammer.database.getRecord(tableName, id)),

  createRecord: async <T extends CrudTableName>(
    tableName: T,
    data: DatabaseRecordInput
  ): Promise<DatabaseEntityMap[T]> =>
    unwrap(await window.jprogrammer.database.createRecord(tableName, data)),

  updateRecord: async <T extends CrudTableName>(
    tableName: T,
    id: string,
    data: DatabaseRecordUpdate
  ): Promise<DatabaseEntityMap[T] | null> =>
    unwrap(await window.jprogrammer.database.updateRecord(tableName, id, data)),

  deleteRecord: async (
    tableName: CrudTableName,
    id: string
  ): Promise<boolean> =>
    unwrap(await window.jprogrammer.database.deleteRecord(tableName, id)),

  resetLocalData: async (): Promise<DatabaseStatus> =>
    unwrap(await window.jprogrammer.database.resetLocalData()),

  getSetting: async (key: string): Promise<SettingRecord | null> =>
    unwrap(await window.jprogrammer.database.getSetting(key)),

  setSetting: async (key: string, value: string): Promise<SettingRecord> =>
    unwrap(await window.jprogrammer.database.setSetting(key, value)),

  persistValidatedScheduleBatch: async (
    request: PersistValidatedScheduleBatchRequest
  ): Promise<PersistValidatedScheduleBatchResult> =>
    unwrap(await window.jprogrammer.database.persistValidatedScheduleBatch(request)),

  persistCompleteGeneratedSchedule: async (
    request: PersistCompleteGeneratedScheduleRequest
  ): Promise<PersistCompleteGeneratedScheduleResult> =>
    unwrap(await window.jprogrammer.database.persistCompleteGeneratedSchedule(request)),

  persistManualAssignmentChange: async (
    request: PersistManualAssignmentChangeRequest
  ): Promise<PersistManualAssignmentChangeResult> =>
    unwrap(await window.jprogrammer.database.persistManualAssignmentChange(request)),

  deleteScheduleRunGraph: async (
    request: DeleteScheduleRunGraphRequest
  ): Promise<DeleteScheduleRunGraphResult> =>
    unwrap(await window.jprogrammer.database.deleteScheduleRunGraph(request))
};

function unwrap<T>(result: DatabaseResult<T>): T {
  if (result.ok) {
    return result.data;
  }

  throw new DatabaseApiError(result.error.code, result.error.message);
}
