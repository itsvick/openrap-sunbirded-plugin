import { Inject } from "typescript-ioc";
import DatabaseSDK from "../../sdk/database";
import * as _ from "lodash";
import config from "../../config";
import Response from "../../utils/response";
import { Manifest } from "@project-sunbird/ext-framework-server/models";
import * as Busboy from "busboy";
import * as fs from "fs";
import { logger } from "@project-sunbird/ext-framework-server/logger";
import * as path from "path";
import { ContentImportManager } from "../../manager/contentImportManager"
import * as uuid from "uuid";
import Hashids from "hashids";
import { containerAPI } from "OpenRAP/dist/api";
import * as TreeModel from "tree-model";
import { HTTPService } from "@project-sunbird/ext-framework-server/services";
import { ExportContent } from "../../manager/contentExportManager"

export enum DOWNLOAD_STATUS {
    SUBMITTED = "DOWNLOADING",
    COMPLETED = "DOWNLOADING",
    EXTRACTED = "DOWNLOADING",
    INDEXED = "DOWNLOADED",
    FAILED = "FAILED"
}
const INTERVAL_TO_CHECKUPDATE = 1
export default class Content {
    private contentsFilesPath: string = 'content';
    private ecarsFolderPath: string = 'ecars';
    @Inject
    private databaseSdk: DatabaseSDK;

    @Inject
    private contentImportManager: ContentImportManager;

    private fileSDK;

    constructor(manifest: Manifest) {
        this.databaseSdk.initialize(manifest.id);
        this.fileSDK = containerAPI.getFileSDKInstance(manifest.id);
        this.contentImportManager.initialize(
            manifest.id,
            this.fileSDK.getAbsPath(this.contentsFilesPath),
            this.fileSDK.getAbsPath(this.ecarsFolderPath)
        );
    }

    searchInDB(filters, reqId, sort?) {
        logger.debug(`ReqId = "${reqId}": Contents are searching in ContentDb with given filters`)
        let modifiedFilters: Object = _.mapValues(filters, (v, k) => {
            if (k !== 'query') return ({ '$in': v })
        });
        delete modifiedFilters['query'];
        logger.info(`ReqId = "${reqId}": Deleted 'query' in modifiedFilters`);
        if (_.get(filters, 'query')) {
            modifiedFilters['name'] = {
                "$regex": new RegExp(_.get(filters, 'query'), 'i')
            }
        }
        modifiedFilters['visibility'] = 'Default';
        let dbFilters = {
            selector: modifiedFilters,
            limit: parseInt(config.get('CONTENT_SEARCH_LIMIT'), 10)
        }
        if (sort) {
            logger.info(`ReqId = "${reqId}": Sort is present. Sorting the contents based on given sort properties`)
            for (let sortFields of Object.keys(sort)) {
                dbFilters.selector[sortFields] = {
                    "$gt": null
                }
            }
            dbFilters['sort'] = [sort];
        }
        logger.debug(`ReqId = "${reqId}": Find the contents in ContentDb with the given filters`)
        return this.databaseSdk.find('content', dbFilters);
    }

    get(req: any, res: any): any {
        (async () => {
            try {
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Called Content get method to get Content: ${req.params.id} `);
                let id = req.params.id;
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Get Content: ${id} from ContentDB`);
                let content = await this.databaseSdk.get('content', id);
                content = _.omit(content, ['_id', '_rev']);
                let resObj = {};
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Call isUpdateRequired()`)
                if (this.isUpdateRequired(content, req)) {
                    logger.debug(`ReqId = "${req.headers['X-msgid']}": Call checkForUpdate() to check whether update is required for content: `, _.get(content, 'identifier'));
                    content = await this.checkForUpdates(content, req)
                    resObj['content'] = content;
                    return res.send(Response.success('api.content.read', resObj, req));
                } else {
                    resObj['content'] = content;
                    return res.send(Response.success('api.content.read', resObj, req));
                }
            } catch (error) {
                logger.error(
                    `ReqId = "${req.headers['X-msgid']}": Received error while getting the data from content database and err.message: ${error}`
                );
                if (error.status === 404) {
                    res.status(404);
                    return res.send(Response.error('api.content.read', 404));
                } else {
                    let status = error.status || 500;
                    res.status(status);
                    return res.send(Response.error('api.content.read', status));
                }
            }
        })()

    }

    search(req: any, res: any): any {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Called content search method`);
        let reqBody = req.body;
        let pageReqFilter = _.get(reqBody, 'request.filters');
        let contentSearchFields = config.get('CONTENT_SEARCH_FIELDS').split(',');
        logger.info(`ReqId = "${req.headers['X-msgid']}": picked filters from the request`);
        let filters = _.pick(pageReqFilter, contentSearchFields);
        filters = _.mapValues(filters, function (v) {
            return _.isString(v) ? [v] : v;
        });
        let query = _.get(reqBody, 'request.query');
        if (!_.isEmpty(query)) {
            filters.query = query;
        }
        logger.info(`ReqId = "${req.headers['X-msgid']}": Got query from the request`);
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Searching Content in Db with given filters`)
        this.searchInDB(filters, req.headers['X-msgid'])
            .then(data => {
                data = _.map(data.docs, doc => _.omit(doc, ['_id', '_rev']));
                let resObj = {};
                if (data.length === 0) {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Contents NOT found in DB`);
                    resObj = {
                        content: [],
                        count: 0
                    };
                } else {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Contents = ${data.length} found in DB`)
                    resObj = {
                        content: data,
                        count: data.length
                    };
                }

                return res.send(Response.success('api.content.search', resObj, req));
            })
            .catch(err => {
                console.log(err);
                logger.error(
                    `ReqId = "${req.headers['X-msgid']}":  Received error while searching content - err.message: ${
                    err.message
                    } ${err}`
                );
                if (err.status === 404) {
                    res.status(404);
                    return res.send(Response.error('api.content.search', 404));
                } else {
                    let status = err.status || 500;
                    res.status(status);
                    return res.send(Response.error('api.content.search', status));
                }
            });
    }

    async import(req: any, res: any) {
        const ecarFilePaths = req.body
        if (!ecarFilePaths) {
            return res.status(400).send(Response.error(`api.content.import`, 400, "MISSING_ECAR_PATH"));
        }
        this.contentImportManager.registerImportJob(ecarFilePaths).then(jobIds => {
            res.send(Response.success('api.content.import', {
                importedJobIds: jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.errMessage || err.message, err.code))
        });
    }
    async pauseImport(req: any, res: any) {
        this.contentImportManager.pauseImport(req.params.importId).then(jobIds => {
            res.send(Response.success('api.content.import', {
                jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.message))
        });
    }
    async resumeImport(req: any, res: any) {
        this.contentImportManager.resumeImport(req.params.importId).then(jobIds => {
            res.send(Response.success('api.content.import', {
                jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.message))
        });;
    }
    async cancelImport(req: any, res: any) {
        await this.contentImportManager.cancelImport(req.params.importId).then(jobIds => {
            res.send(Response.success('api.content.import', {
                jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.message))
        });;
    }

    async export(req: any, res: any): Promise<any> {
        let id = req.params.id;
        let destFolder = req.query.destFolder;
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Get Content: ${id} from ContentDB`)
        let content = await this.databaseSdk.get('content', id);
        let childNode = [];
        if (content.mimeType === 'application/vnd.ekstep.content-collection') {
            let dbChildResponse = await this.databaseSdk.find('content',
                {
                    selector: {
                        $and: [
                            {
                                _id: {
                                    $in: content.childNodes
                                }
                            },
                            {
                                mimeType: {
                                    $nin: ['application/vnd.ekstep.content-collection']
                                }
                            }
                        ]
                    }
                }
            );
            childNode = dbChildResponse.docs;
        }
        const contentExport = new ExportContent(destFolder, content, childNode);
        contentExport.export((err, data) => {
            if (err) {
                res.status(500);
                return res.send(Response.error('api.content.export', 500));
            }
            res.status(200);
            res.send(Response.success(`api.content.export`, {
                    response: {
                        ecarFilePath: data.ecarFilePath
                    }
                }, req));
        });
    }

    /* This method converts the buffer data to json and if any error will catch and return the buffer data */

    convertBufferToJson(proxyResData, req) {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Converting Bufferdata to json`)
        let proxyData;
        try {
            proxyData = JSON.parse(proxyResData.toString('utf8'));
        } catch (e) {
            console.log(e);
            logger.error(
                `ReqId = "${req.headers['X-msgid']}": Received error while parsing the Bufferdata to json: ${e}`
            );
            return proxyResData;
        }
        logger.info(`ReqId = "${req.headers['X-msgid']}": Succesfully converted Bufferdata to json`)
        return proxyData;
    }

    /*This method is to whether content is present and to store all the contents in all page sections to one array */

    decorateSections(sections, reqId) {
        logger.debug(`ReqId = "${reqId}": Called decorateSections to decorate content`)
        let contents = [];
        logger.info(`ReqId = "${reqId}": Fetching all the contentId's from all the sections into an array`);
        for (let section of sections) {
            if (!_.isEmpty(section.contents)) {
                for (let content of section.contents) {
                    contents.push(content);
                }
            }
        }
        logger.debug(`ReqId = "${reqId}": Calling decorateContent from decoratesections`)
        return this.decorateContentWithProperty(contents, reqId);
    }

    /* This method is to check contents are present in DB */

    async decorateContentWithProperty(contents, reqId) {
        logger.debug(`ReqId = "${reqId}": Called decorateContent to decorate content`)
        try {
            let listOfContentIds = [];
            logger.info(`ReqId = "${reqId}": Pushing all the contentId's to an Array for all the requested Contents`)
            for (let content of contents) {
                listOfContentIds.push(content.identifier);
            }
            logger.debug(`ReqId = "${reqId}": Search downloaded and downloading  contents in DB using content Id's`)
            await this.searchDownloadingContent(listOfContentIds, reqId)
                .then(data => {
                    logger.info(`ReqId = "${reqId}": Found the ${data.docs.length} contents in Content_Download Db`)
                    for (let doc of data.docs) {
                        for (let content of contents) {
                            if (doc.contentId === content.identifier) {
                                content.downloadStatus = DOWNLOAD_STATUS[doc.status];
                            }
                        }
                    }
                })
                .catch(err => {
                    console.log(err);
                    logger.error(
                        `ReqId = "${reqId}": Received error while getting the data from database and err.message: ${
                        err.message
                        } ${err}`
                    );
                    return contents;
                });
        } catch (err) {
            console.log(err);
            logger.error(`ReqId = "${reqId}": Received  error err.message: ${err.message} ${err}`);
            return contents;
        }
        return contents;
    }

    /* This method is to check dialcode contents present in DB */

    decorateDialCodeContents(content, reqId) {
        logger.debug(`ReqId = "${reqId}": Decorating Dial Code Contents`);
        const model = new TreeModel();
        let treeModel;
        treeModel = model.parse(content);
        let contents = [];
        contents.push(content);
        logger.info(`ReqId = "${reqId}": walking through all the nodes and pushing all the child nodes to an array`);
        treeModel.walk(node => {
            if (node.model.mimeType !== 'application/vnd.ekstep.content-collection') {
                contents.push(node.model);
            }
        });
        logger.debug(`ReqId = "${reqId}": Calling decorateContent from decoratedialcode`)
        return this.decorateContentWithProperty(contents, reqId);
    }

    /* This method is to search contents for download status in database  */

    searchDownloadingContent(contents, reqId) {
        logger.debug(`ReqId = "${reqId}": searchDownloadingContent method is called`);
        let dbFilters = {
            "selector": {
                "contentId": {
                    "$in": contents
                }
            }
        }
        logger.info(`ReqId = "${reqId}": finding downloading, downloaded or failed contents in database`)
        return this.databaseSdk.find('content_download', dbFilters)
    }

    isUpdateRequired(content, req) {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Called isUpdateRequired()`);

        if (_.get(content, 'desktopAppMetadata.updateAvailable')) {
            logger.info(`ReqId = "${req.headers['X-msgid']}": updateAvailble for content and Don't call API`);
            return false;
        } else if (_.get(content, 'desktopAppMetadata.lastUpdateCheckedOn')) {
            logger.info(`ReqId = "${req.headers['X-msgid']}": checking when is the last updatechecked on`, _.get(content, 'desktopAppMetadata.lastUpdateCheckedOn'));
            return ((Date.now() - _.get(content, 'desktopAppMetadata.lastUpdateCheckedOn')) / 3600000) > INTERVAL_TO_CHECKUPDATE ? true : false;
        }
        logger.info(`ReqId = "${req.headers['X-msgid']}": update is not available for content and call API`);
        return true;
    }


    checkForUpdates(offlineContent, req) {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": calling api to check whether content: ${_.get(offlineContent, 'idenitifier')} is updated`);
        return new Promise(async (resolve, reject) => {
            try {
                let onlineContent = await HTTPService.get(`${process.env.APP_BASE_URL}/api/content/v1/read/${offlineContent.identifier}?field=pkgVersion`, {}).toPromise();
                if (_.get(offlineContent, 'pkgVersion') < _.get(onlineContent, 'data.result.content.pkgVersion')) {
                    offlineContent.desktopAppMetadata.updateAvailable = true;
                }
                offlineContent.desktopAppMetadata.lastUpdateCheckedOn = Date.now();
                await this.databaseSdk.update('content', offlineContent.identifier, offlineContent);
                resolve(offlineContent);
            } catch (err) {
                logger.error(`ReqId = "${req.headers['X-msgid']}": Error occured while checking content update : ${err}`);
                resolve(offlineContent);
            }
        })
    }

}
