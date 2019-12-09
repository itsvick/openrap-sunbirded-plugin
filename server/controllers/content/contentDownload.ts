import { Inject } from "typescript-ioc";
import DatabaseSDK from "../../sdk/database";
import * as _ from 'lodash';
import Response from '../../utils/response';
import { Manifest } from "@project-sunbird/ext-framework-server/models";
import { logger } from '@project-sunbird/ext-framework-server/logger';
import { containerAPI } from "OpenRAP/dist/api";
import { HTTPService } from "@project-sunbird/ext-framework-server/services";
import * as path from "path";
import { ImportStatus, IContentImport } from "../../manager/contentImportManager"
import { IAddedUsingType } from '../../controllers/content/IContent';
const sessionStartTime = Date.now();
export enum CONTENT_DOWNLOAD_STATUS {
    Submitted = "SUBMITTED",
    Completed = "COMPLETED",
    Extracted = "EXTRACTED",
    Indexed = "INDEXED",
    Failed = "FAILED"
}
enum API_DOWNLOAD_STATUS {
    inprogress = "INPROGRESS",
    submitted = "SUBMITTED",
    completed = "COMPLETED",
    failed = "FAILED"
}

let dbName = "content_download";
export default class ContentDownload {

    private contentsFilesPath: string = 'content';
    private ecarsFolderPath: string = 'ecars';

    @Inject
    private databaseSdk: DatabaseSDK;

    private downloadManager;
    private pluginId;

    constructor(manifest: Manifest) {
        this.databaseSdk.initialize(manifest.id);
        this.pluginId = manifest.id;
        this.downloadManager = containerAPI.getDownloadManagerInstance(this.pluginId);
    }

    download(req: any, res: any): any {
        (async () => {
            try {
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Content Download method is called`);
                // get the content using content read api
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Get the content using content read api`)
                let content = await HTTPService.get(`${process.env.APP_BASE_URL}/api/content/v1/read/${req.params.id}`, {}).toPromise()
                logger.info(`ReqId = "${req.headers['X-msgid']}": Content: ${_.get(content, 'data.result.content.identifier')} found from content read api`);
                if (_.get(content, 'data.result.content.mimeType')) {
                    // check if the content is type collection
                    logger.debug(`ReqId = "${req.headers['X-msgid']}": check if the content is of type collection`)
                    if (_.get(content, 'data.result.content.mimeType') !== "application/vnd.ekstep.content-collection") {
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Found content:${_.get(content, 'data.result.content.mimeType')} is not of type collection`)
                        // insert to the to content_download_queue
                        // add the content to queue using downloadManager
                        let downloadFiles = [{
                            id: (_.get(content, "data.result.content.identifier") as string),
                            url: (_.get(content, "data.result.content.downloadUrl") as string),
                            size: (_.get(content, "data.result.content.size") as number)
                        }]
                        let downloadId = await this.downloadManager.download(downloadFiles, 'ecars')
                        let queueMetaData = {
                            mimeType: _.get(content, 'data.result.content.mimeType'),
                            items: downloadFiles,
                            pkgVersion: _.get(content, 'data.result.content.pkgVersion'),
                            contentType: _.get(content, 'data.result.content.contentType'),
                            resourceId: _.get(content, "data.result.content.identifier")
                        }
                        logger.debug(`ReqId = "${req.headers['X-msgid']}": insert to the content_download_queue`);
                        await this.databaseSdk.insert(dbName, {
                            downloadId: downloadId,
                            contentId: _.get(content, "data.result.content.identifier"),
                            name: _.get(content, "data.result.content.name"),
                            status: CONTENT_DOWNLOAD_STATUS.Submitted,
                            queueMetaData: queueMetaData,
                            createdOn: Date.now(),
                            updatedOn: Date.now(),
                            size: (_.get(content, "data.result.content.size") as number)
                        })
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Content Inserted in Database Successfully`);
                        return res.send(Response.success("api.content.download", { downloadId }, req));
                        // return response the downloadId
                    } else {
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Found content:${_.get(content, 'data.result.content.mimeType')} is of type collection`)
                        let downloadFiles = [{
                            id: (_.get(content, "data.result.content.identifier") as string),
                            url: (_.get(content, "data.result.content.downloadUrl") as string),
                            size: (_.get(content, "data.result.content.size") as number)
                        }];
                        let totalCollectionSize = _.get(content, "data.result.content.size");

                        // get the child contents
                        let childNodes = _.get(content, "data.result.content.childNodes")
                        if (!_.isEmpty(childNodes)) {
                            logger.debug(`ReqId = "${req.headers['X-msgid']}": Get the child contents using content search API`);
                            let childrenContentsRes = await HTTPService.post(`${process.env.APP_BASE_URL}/api/content/v1/search`,
                                {
                                    "request": {
                                        "filters": {
                                            "identifier": childNodes,
                                            "mimeType": { "!=": "application/vnd.ekstep.content-collection" }
                                        },
                                        "limit": childNodes.length
                                    }
                                }, {
                                headers: {
                                    "Content-Type": "application/json"
                                }
                            }).toPromise();
                            logger.info(`ReqId = "${req.headers['X-msgid']}": Found child contents: ${_.get(childrenContentsRes, 'data.result.count')}`);
                            if (_.get(childrenContentsRes, 'data.result.count')) {
                                let contents = _.get(childrenContentsRes, 'data.result.content');
                                for (let content of contents) {
                                    totalCollectionSize += _.get(content, "size");
                                    downloadFiles.push({
                                        id: (_.get(content, "identifier") as string),
                                        url: (_.get(content, "downloadUrl") as string),
                                        size: (_.get(content, "size") as number)
                                    })
                                }
                            }

                        }
                        let downloadId = await this.downloadManager.download(downloadFiles, 'ecars')
                        let queueMetaData = {
                            mimeType: _.get(content, 'data.result.content.mimeType'),
                            items: downloadFiles,
                            pkgVersion: _.get(content, 'data.result.content.pkgVersion'),
                            contentType: _.get(content, 'data.result.content.contentType'),
                            resourceId: _.get(content, "data.result.content.identifier")
                        }
                        logger.debug(`ReqId = "${req.headers['X-msgid']}": insert collection in Database`);
                        await this.databaseSdk.insert(dbName, {
                            downloadId: downloadId,
                            contentId: _.get(content, "data.result.content.identifier"),
                            name: _.get(content, "data.result.content.name"),
                            status: CONTENT_DOWNLOAD_STATUS.Submitted,
                            queueMetaData: queueMetaData,
                            createdOn: Date.now(),
                            updatedOn: Date.now(),
                            size: totalCollectionSize
                        })
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Collection inserted successfully`);
                        return res.send(Response.success("api.content.download", { downloadId }, req));
                    }
                } else {
                    logger.error(`ReqId = "${req.headers['X-msgid']}": Received error while processing download request ${content}, for content ${req.params.id}`);
                    res.status(500)
                    return res.send(Response.error("api.content.download", 500))
                }

            } catch (error) {
                logger.error(`ReqId = "${req.headers['X-msgid']}": Received error while processing download request and err.message: ${error.message}, for content ${req.params.id}`);
                res.status(500)
                return res.send(Response.error("api.content.download", 500))
            }
        })()
    }

    list(req: any, res: any): any {
        (async () => {
            logger.debug(`ReqId = "${req.headers['X-msgid']}": ContentDownload List method is called`);
            try {
                let status = [API_DOWNLOAD_STATUS.submitted, API_DOWNLOAD_STATUS.inprogress, API_DOWNLOAD_STATUS.completed, API_DOWNLOAD_STATUS.failed];
                if (!_.isEmpty(_.get(req, 'body.request.filters.status'))) {
                    status = _.get(req, 'body.request.filters.status');
                }
                let submitted = [];
                let inprogress = [];
                let failed = [];
                let completed = [];
                let contentListArray = [];
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Check download status is submitted or not`);
                if (_.indexOf(status, API_DOWNLOAD_STATUS.submitted) !== -1) {
                    // submitted - get from the content downloadDB and merge with data
                    logger.info(`ReqId = "${req.headers['X-msgid']}": download status is submitted`);
                    logger.debug(`ReqId = "${req.headers['X-msgid']}": Find submitted contents in ContentDb`)
                    let submitted_CDB = await this.databaseSdk.find(dbName, {
                        "selector": {
                            "status": CONTENT_DOWNLOAD_STATUS.Submitted
                        }
                    });
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Found Submitted Contents: ${submitted_CDB.docs.length}`)
                    if (!_.isEmpty(submitted_CDB.docs)) {
                        submitted = _.map(submitted_CDB.docs, (doc) => {
                            return {
                                "id": doc.downloadId,
                                "contentId": doc.contentId,
                                "resourceId": _.get(doc, 'queueMetaData.resourceId'),
                                "mimeType": doc.queueMetaData.mimeType,
                                "name": doc.name,
                                "status": ImportStatus[2],
                                "createdOn": doc.createdOn,
                                "pkgVersion": _.get(doc, 'queueMetaData.pkgVersion'),
                                "contentType": _.get(doc, 'queueMetaData.contentType'),
                                "totalSize": doc.size,
                                "addedUsing": "download"
                            };
                        })
                    }
                }
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Check download status is completed or not`);
                if (_.indexOf(status, API_DOWNLOAD_STATUS.completed) !== -1) {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": download status is completed`);
                    logger.debug(`ReqId = "${req.headers['X-msgid']}": Find completed contents in ContentDb`)
                    let completed_CDB = await this.databaseSdk.find(dbName, {
                        "selector": {
                            "status": CONTENT_DOWNLOAD_STATUS.Indexed,
                            "updatedOn": {
                                "$gt": sessionStartTime
                            },
                            "createdOn": {
                                "$gt": null
                            }
                        },
                        "limit": 50,
                        "sort": [
                            {
                                "createdOn": "desc"
                            }
                        ]
                    });
                    if (!_.isEmpty(completed_CDB.docs)) {
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Found Submitted Contents: ${completed_CDB.docs.length}`)
                        completed = _.map(completed_CDB.docs, (doc) => {
                            return {
                                "id": doc.downloadId,
                                "contentId": doc.contentId,
                                "resourceId": _.get(doc, 'queueMetaData.resourceId'),
                                "mimeType": doc.queueMetaData.mimeType,
                                "name": doc.name,
                                "status": ImportStatus[8],
                                "createdOn": doc.createdOn,
                                "pkgVersion": _.get(doc, 'queueMetaData.pkgVersion'),
                                "contentType": _.get(doc, 'queueMetaData.contentType'),
                                "totalSize": doc.size,
                                "addedUsing": "download"
                            };
                        })
                    }
                }

                // inprogress - get from download queue and merge with content data
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Check download status is inprogress or not`);
                if (_.indexOf(status, API_DOWNLOAD_STATUS.inprogress) !== -1) {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": download status is inprogress`);
                    let inprogressItems = await this.downloadManager.list(["INPROGRESS"]);
                    if (!_.isEmpty(inprogressItems)) {
                        let downloadIds = _.map(inprogressItems, 'id');
                        submitted = _.filter(submitted, (s) => { return _.indexOf(downloadIds, s.id) === -1 });
                        logger.debug(`ReqId = "${req.headers['X-msgid']}": Find inprogress contents in ContentDb`)
                        let itemIn_CDB = await this.databaseSdk.find(dbName, {
                            "selector": {
                                "downloadId": {
                                    "$in": downloadIds
                                },
                                "createdOn": {
                                    "$gt": null
                                }
                            },
                            "sort": [
                                {
                                    "createdOn": "desc"
                                }
                            ]
                        });
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Found inprogress Contents: ${itemIn_CDB.docs.length}`)
                        _.forEach(inprogressItems, (item) => {
                            let contentItem = _.find(itemIn_CDB.docs, { downloadId: item.id })
                            inprogress.push({
                                contentId: _.get(contentItem, 'contentId'),
                                id: item.id,
                                resourceId: _.get(contentItem, 'queueMetaData.resourceId'),
                                name: _.get(contentItem, 'name') || 'Unnamed download',
                                totalSize: item.stats.totalSize,
                                downloadedSize: item.stats.downloadedSize,
                                status: ImportStatus[3],
                                createdOn: _.get(contentItem, 'createdOn') || item.createdOn,
                                addedUsing: "download"
                            })
                        })
                    }
                }


                // failed -  get from the content downloadDB and download queue
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Check download status is failed or not`);
                if (_.indexOf(status, API_DOWNLOAD_STATUS.failed) !== -1) {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": download status is failed`);
                    logger.debug(`ReqId = "${req.headers['X-msgid']}": Find Failed contents in ContentDb`)
                    let failed_CDB = await this.databaseSdk.find(dbName, {
                        "selector": {
                            "status": CONTENT_DOWNLOAD_STATUS.Failed,
                            "updatedOn": {
                                "$gt": sessionStartTime
                            },
                            "createdOn": {
                                "$gt": null
                            }
                        },
                        "limit": 50,
                        "sort": [
                            {
                                "createdOn": "desc"
                            }
                        ]
                    });
                    if (!_.isEmpty(failed_CDB.docs)) {
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Found inprogress Contents: ${failed_CDB.docs.length}`)
                        failed = _.map(failed_CDB.docs, (doc) => {
                            return {
                                "id": doc.downloadId,
                                "contentId": doc.contentId,
                                "resourceId": _.get(doc, 'queueMetaData.resourceId'),
                                "mimeType": doc.queueMetaData.mimeType,
                                "name": doc.name,
                                "status": ImportStatus[9],
                                "createdOn": doc.createdOn,
                                "pkgVersion": _.get(doc, 'queueMetaData.pkgVersion'),
                                "contentType": _.get(doc, 'queueMetaData.contentType'),
                                "totalSize": doc.size,
                                "addedUsing": "download"
                            };
                        })
                    }
                }


                logger.info(`ReqId = "${req.headers['X-msgid']}": Received all downloaded Contents`);
                const importJobs = await this.listContentImport();
                contentListArray = _.concat(submitted, inprogress, failed, completed, importJobs.importList)

                return res.send(Response.success("api.content.download.list", {
                    response: {
                        contents: contentListArray,
                    }
                }, req));

            } catch (error) {
                logger.error(`ReqId = "${req.headers['X-msgid']}": Error while processing the list request and err.message: ${error.message}`)
                res.status(500)
                return res.send(Response.error("api.content.download.list", 500))
            }
        })()
    }
    // TODO:Query needs to be optimized
    public async listContentImport() {
        const importJobs = await this.databaseSdk.find('content_manager', {
            "selector": {
                $or: [
                    {
                        type: IAddedUsingType.import,
                        status: {
                            "$in": [ImportStatus.inProgress, ImportStatus.inQueue, ImportStatus.reconcile, ImportStatus.pausing, ImportStatus.paused,
                            ImportStatus.resume]
                        }
                    },
                    {
                        type: IAddedUsingType.import,
                        status: {
                            "$in": [ImportStatus.failed, ImportStatus.completed]
                        },
                        updatedOn: {
                            "$gt": sessionStartTime
                        }
                    }
                ]
            }
        }).catch((error) => {
            console.error('Error while fetching content import status');
            return { docs: [] }
        });
        const contentImportJobs = {
            importList: []
        };
        _.forEach(importJobs.docs, (job: IContentImport) => {
            const jobObj = {
                contentId: job.contentId,
                id: job._id,
                resourceId: job.contentId,
                name: job.name,
                totalSize: job.contentSize,
                downloadedSize: job.progress,
                status: ImportStatus[job.status],
                createdOn: job.createdOn,
                pkgVersion: job.pkgVersion,
                mimeType: job.mimeType,
                failedCode: job.failedCode,
                failedReason: job.failedReason,
                addedUsing: job.type
            }

            contentImportJobs.importList.push(jobObj)
        });
        return contentImportJobs;
    }
}