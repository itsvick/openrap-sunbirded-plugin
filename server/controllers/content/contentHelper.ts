import { EventManager } from "@project-sunbird/ext-framework-server/managers/EventManager"
import { CONTENT_DOWNLOAD_STATUS } from "./contentDownload";
import DatabaseSDK from '../../sdk/database';
import { containerAPI } from "OpenRAP/dist/api";
import * as path from "path";
import { logger } from "@project-sunbird/ext-framework-server/logger";
import * as glob from 'glob';
import * as _ from 'lodash';
import { STATUS } from "OpenRAP/dist/managers/DownloadManager/DownloadManager";
import { IDesktopAppMetadata, IAddedUsingType } from './IContent';

let dbSDK = new DatabaseSDK();

let dbName = "content_download";

export const addContentListener = (pluginId) => {
    dbSDK.initialize(pluginId);
    let fileSDK = containerAPI.getFileSDKInstance(pluginId);
    EventManager.subscribe(`${pluginId}:download:complete`, async (data) => {
        try {
            // update the status to completed
            let { docs } = await dbSDK.find(dbName, {
                selector: {
                    downloadId: data.id
                }
            });
            let _id = docs[0]["_id"];
            let parentId = docs[0]["contentId"];
            let isCollection = (docs[0]["queueMetaData"]["mimeType"] === "application/vnd.ekstep.content-collection")

            await dbSDK.update(dbName, _id, { status: CONTENT_DOWNLOAD_STATUS.Completed, updatedOn: Date.now() });
            let failFlagCount = 0;
            for (let file of data.files) {
                try {
                    /*
                                        {
                          "id": "do_21256975952798515213721",
                          "file": "creation-100100_1542778850847_do_21256975952798515213721_2.0.ecar",
                          "source": "<url>",
                          "path": "<basePath>/ecars",
                          "size": 7813097,
                          "downloaded": 7813097
                        }
                                    */
                    // extract each file 
                    let fileName = path.basename(file.file, path.extname(file.file))

                    // Deleting content folder if exist. This is done as content folder is not getting updated after unzipping content with updates
                    await deleteContentFolder(file, fileSDK).catch(error => {
                        logger.error(`Received Error while getting content data from db where error = ${error}`);
                    });    

                    await fileSDK.unzip(path.join('ecars', file.file), path.join('content', fileName), false)
                    await fileSDK.remove(path.join('ecars', file.file));
                    let zipFilePath = glob.sync(path.join(fileSDK.getAbsPath('content'), fileName, '**', '*.zip'), {});
                    if (zipFilePath.length > 0) {
                        // unzip the file if we have zip file
                        let filePath = path.relative(fileSDK.getAbsPath(''), zipFilePath[0]);
                        await fileSDK.unzip(filePath, path.join("content", fileName), false)
                    }

                    let manifest = await fileSDK.readJSON(path.join(fileSDK.getAbsPath('content'), fileName, 'manifest.json'));
                    let items = _.get(manifest, 'archive.items');

                    /* read manifest json and add the 
                    desktopAppMetadata: {
                        ecarFile:""  // relative to ecar folder
                        addedUsing: "" // import or download
                    }
                    */
                    let metaData = items[0];
                    if (isCollection && file.id === parentId) {
                        metaData = _.find(items, (i) => {
                            return (i.mimeType === 'application/vnd.ekstep.content-collection' && i.visibility === 'Default')
                        });
                        let itemsClone = _.cloneDeep(items);
                        let children = createHierarchy(itemsClone, metaData)
                        metaData['children'] = children;
                    } else if (isCollection && file.id !== parentId) {
                        metaData.visibility = "Parent"
                    }
                    metaData.baseDir = `content/${fileName}`;

                    let folderToDelete = [];
                    if(metaData.appIcon){
                        const appIconFileName = path.basename(metaData.appIcon);
                        await fileSDK.move(path.join('content', fileName, metaData.appIcon), path.join('content', fileName, appIconFileName))
                        folderToDelete.push(path.join('content', fileName, path.dirname(metaData.appIcon)))
                        metaData.appIcon = `content/${fileName}/${appIconFileName}`;
                    }
                    if(metaData.artifactUrl && path.extname(metaData.artifactUrl) && path.extname(metaData.artifactUrl) !== '.zip'){
                        const artifactName = path.basename(metaData.artifactUrl);
                        await fileSDK.move(path.join('content', fileName, metaData.artifactUrl), path.join('content', fileName, artifactName))
                        folderToDelete.push(path.join('content', fileName, path.dirname(metaData.artifactUrl)))
                    } else if(metaData.artifactUrl && path.extname(metaData.artifactUrl) && path.extname(metaData.artifactUrl) === '.zip'){
                        folderToDelete.push(path.join('content', fileName, path.dirname(metaData.artifactUrl)))
                    }
                    folderToDelete = _.union(folderToDelete);
                    for(const path of folderToDelete){
                        await fileSDK.remove(path);
                    }
                    const desktopAppMetadata: IDesktopAppMetadata = {
                        "addedUsing": IAddedUsingType.download,
                        "createdOn": Date.now(),
                        "updatedOn": Date.now()
                    }
                    metaData.desktopAppMetadata = desktopAppMetadata;
                    //insert metadata to content database
                    // TODO: before insertion check if the first object is type of collection then prepare the collection and insert 

                    await dbSDK.upsert('content', metaData.identifier, metaData)


                    // upsert the content meta to content db

                    // update content db to extracted
                    // update the status to indexed
                } catch (error) {
                    failFlagCount++
                    logger.error(`Received error while content is extracted for id: ${data.id} and and err.message: ${error.message}`)
                }
            }
            if (failFlagCount === data.files.length) {
                await dbSDK.update(dbName, _id, { status: CONTENT_DOWNLOAD_STATUS.Failed, updatedOn: Date.now() })
            } else {
                await dbSDK.update(dbName, _id, { status: CONTENT_DOWNLOAD_STATUS.Indexed, updatedOn: Date.now() })
            }
        } catch (error) {
            logger.error(`Received error while listening to content complete event for id: ${data.id} and err.message: ${error.message}`)
        }
    })

    EventManager.subscribe(`${pluginId}:download:failed`, async (data) => {
        try {
            let { docs } = await dbSDK.find(dbName, {
                selector: {
                    downloadId: data.id
                }
            });
            let _id = docs[0]["_id"];
            await dbSDK.update(dbName, _id, { status: CONTENT_DOWNLOAD_STATUS.Failed, updatedOn: Date.now() })
        } catch (error) {
            logger.error(`Received error while updating the failed status in content download DB and err.message: ${error.message}`);
        }
    })
}

export const deleteContentFolder = async (file, fileSDK) => {
    const contentData = await dbSDK.get('content', file.id);
    if (_.get(contentData, 'desktopAppMetadata.ecarFile')) {
        const toBeDeletedFileName = path.basename(_.get(contentData, 'desktopAppMetadata.ecarFile'), '.ecar');

        // Todo: Should be removed when importing logic changes and the data gets saved with the identifier
        if (file.id !== toBeDeletedFileName) {
            await fileSDK.remove(path.join('ecars', _.get(contentData, 'desktopAppMetadata.ecarFile')));
        }

        await fileSDK.remove((path.join('content', toBeDeletedFileName)));
    }
    return true;
}

export const createHierarchy = (items: any[], parent: any, tree?: any[]): any => {
    tree = typeof tree !== 'undefined' ? tree : [];
    parent = typeof parent !== 'undefined' ? parent : { visibility: 'Default' };
    if (parent.children && parent.children.length) {
        let children = [];
        _.forEach(items, (child) => {
            let childWithIndex = _.find(parent.children, { 'identifier': child.identifier })
            if (!_.isEmpty(childWithIndex)) {
                child.index = childWithIndex['index'];
                children.push(child)
            }
        });
        if (!_.isEmpty(children)) {
            children = _.sortBy(children, 'index');
            if (parent.visibility === 'Default') {
                tree = children;
            } else {
                parent['children'] = children;
            }
            _.each(children, (child) => { createHierarchy(items, child) });
        }
    }
    return tree;
}

export const reconciliation = async (pluginId) => {
    try {

        let downloadManager = containerAPI.getDownloadManagerInstance(pluginId);
        dbSDK.initialize(pluginId);
        // get the submitted events
        let { docs } = await dbSDK.find(dbName, {
            selector: {
                status: CONTENT_DOWNLOAD_STATUS.Submitted
            }
        })
        if (!_.isEmpty(docs)) {
            // check the status in download queue

            for (let item of docs) {
                let downloadItem = await downloadManager.get(item.downloadId);
                if (downloadItem.status === STATUS.EventEmitted) {
                    //if eventemitted then trigger completed event
                    EventManager.emit(`${pluginId}:download:complete`, downloadItem)
                }
                if (downloadItem.status === STATUS.Failed) {
                    // if failed trigger failed event
                    EventManager.emit(`${pluginId}:download:failed`, downloadItem)

                }

            }
        }

    } catch (error) {
        logger.error(`Received error while running reconciliation in plugin for content update sync and err.message: ${error.message}`)
    }


}