export enum IAddedUsingType {
    import = "import",
    download = "download",
}

export interface IDesktopAppMetadata {
    'ecarFile'?: string;
    'addedUsing': IAddedUsingType;
    'createdOn': number;
    'updatedOn': number;
    'updateAvailable'?: boolean;
    'lastUpdateCheckedOn'?: number;
}
