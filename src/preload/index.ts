import { contextBridge, ipcRenderer } from "electron";
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
  PdfExportRequest,
  PdfExportResult,
  PersistCompleteGeneratedScheduleRequest,
  PersistCompleteGeneratedScheduleResult,
  PersistManualAssignmentChangeRequest,
  PersistManualAssignmentChangeResult,
  PersistValidatedScheduleBatchRequest,
  PersistValidatedScheduleBatchResult,
  SettingRecord
} from "../shared/types";
import type {
  CpSatSolveRequest,
  CpSatSolveResult,
  SolverAvailability
} from "../shared/solverTypes";

const api = {
  getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
  exportPdf: (request: PdfExportRequest) =>
    ipcRenderer.invoke("pdf:export", request) as Promise<PdfExportResult>,
  database: {
    getStatus: () =>
      ipcRenderer.invoke("database:getStatus") as Promise<
        DatabaseResult<DatabaseStatus>
      >,
    listRecords: <T extends CrudTableName>(
      tableName: T,
      options?: ListRecordsOptions
    ) =>
      ipcRenderer.invoke("database:listRecords", tableName, options) as Promise<
        DatabaseResult<DatabaseEntityMap[T][]>
      >,
    getRecord: <T extends CrudTableName>(tableName: T, id: string) =>
      ipcRenderer.invoke("database:getRecord", tableName, id) as Promise<
        DatabaseResult<DatabaseEntityMap[T] | null>
      >,
    createRecord: <T extends CrudTableName>(
      tableName: T,
      data: DatabaseRecordInput
    ) =>
      ipcRenderer.invoke("database:createRecord", tableName, data) as Promise<
        DatabaseResult<DatabaseEntityMap[T]>
      >,
    updateRecord: <T extends CrudTableName>(
      tableName: T,
      id: string,
      data: DatabaseRecordUpdate
    ) =>
      ipcRenderer.invoke(
        "database:updateRecord",
        tableName,
        id,
        data
      ) as Promise<DatabaseResult<DatabaseEntityMap[T] | null>>,
    deleteRecord: (tableName: CrudTableName, id: string) =>
      ipcRenderer.invoke("database:deleteRecord", tableName, id) as Promise<
        DatabaseResult<boolean>
      >,
    resetLocalData: () =>
      ipcRenderer.invoke("database:resetLocalData") as Promise<
        DatabaseResult<DatabaseStatus>
      >,
    getSetting: (key: string) =>
      ipcRenderer.invoke("database:getSetting", key) as Promise<
        DatabaseResult<SettingRecord | null>
      >,
    setSetting: (key: string, value: string) =>
      ipcRenderer.invoke("database:setSetting", key, value) as Promise<
        DatabaseResult<SettingRecord>
      >,
    persistValidatedScheduleBatch: (request: PersistValidatedScheduleBatchRequest) =>
      ipcRenderer.invoke(
        "database:persistValidatedScheduleBatch",
        request
      ) as Promise<
        DatabaseResult<PersistValidatedScheduleBatchResult>
      >,
    persistCompleteGeneratedSchedule: (
      request: PersistCompleteGeneratedScheduleRequest
    ) =>
      ipcRenderer.invoke(
        "database:persistCompleteGeneratedSchedule",
        request
      ) as Promise<
        DatabaseResult<PersistCompleteGeneratedScheduleResult>
      >,
    persistManualAssignmentChange: (
      request: PersistManualAssignmentChangeRequest
    ) =>
      ipcRenderer.invoke(
        "database:persistManualAssignmentChange",
        request
      ) as Promise<
        DatabaseResult<PersistManualAssignmentChangeResult>
      >,
    deleteScheduleRunGraph: (request: DeleteScheduleRunGraphRequest) =>
      ipcRenderer.invoke(
        "database:deleteScheduleRunGraph",
        request
      ) as Promise<
        DatabaseResult<DeleteScheduleRunGraphResult>
      >
  },
  solver: {
    getCpSatAvailability: () =>
      ipcRenderer.invoke("solver:getCpSatAvailability") as Promise<
        DatabaseResult<SolverAvailability>
      >,
    solveScheduleWithCpSat: (request: CpSatSolveRequest) =>
      ipcRenderer.invoke("solver:solveScheduleWithCpSat", request) as Promise<
        DatabaseResult<CpSatSolveResult>
      >
  }
};

contextBridge.exposeInMainWorld("jprogrammer", api);

export type JProgrammerApi = typeof api;
