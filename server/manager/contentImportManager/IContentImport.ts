export enum ImportSteps {
  copyEcar = "COPY_ECAR",
  parseEcar = "PARSE_ECAR",
  extractEcar = "EXTRACT_ECAR",
  processContents = "PROCESS_CONTENTS",
  complete = "COMPLETE"
}
export enum ImportProgress {
  "COPY_ECAR" = 1,
  "PARSE_ECAR" = 25,
  "EXTRACT_ECAR" = 26,
  "EXTRACT_ARTIFACT" = 90,
  "PROCESS_CONTENTS" = 99,
  "COMPLETE" = 100
}
// Caution: reordering the enum might break the import flow
export enum ImportStatus {
  reconcile,
  resume,
  inQueue,
  inProgress,
  pausing,
  paused,
  canceling,
  canceled,
  completed,
  failed
}

export interface IContentImport {
  _id: string;
  _rev?: string;
  status: ImportStatus;
  type: string;
  name: string;
  createdOn: number;
  updatedOn: number;
  progress: number;
  contentSize: number;
  contentId?: string;
  mimeType?: string;
  pkgVersion?: string;
  failedCode?: string;
  failedReason?: string;
  ecarSourcePath: string;
  importStep?: ImportSteps;
  extractedEcarEntries: Object;
  artifactUnzipped: Object;
  childNodes?: Array<string>;
}
export interface IContentManifest {
  archive: {
    items: Array<any>;
  };
}
export class ErrorObj {
  constructor(public errCode: string, public errMessage: string){
  }
}
export const getErrorObj = (error, errCode = "UNHANDLED_ERROR") => {
  if(error instanceof ErrorObj){
    return error;
  }
  return new ErrorObj(errCode, error.message);
}
export const handelError = (errCode) => {
  return (error: Error) => {
    throw getErrorObj(error, errCode);
  }
}