import { IContentImport, ImportSteps, ImportProgress, getErrorObj, handelError, ErrorObj } from './IContentImport'
import * as  StreamZip from 'node-stream-zip';
import * as  fs from 'fs';
import * as  _ from 'lodash';
import * as path from 'path';
import { manifest } from '../../manifest';
import { containerAPI } from 'OpenRAP/dist/api';
import config from '../../config';
import { Subject } from 'rxjs';
import { throttleTime} from 'rxjs/operators';

let zipHandler;
let contentImportData: IContentImport;
let dbContents;
let fileSDK = containerAPI.getFileSDKInstance(manifest.id);
const contentFolder = fileSDK.getAbsPath('content');
const ecarFolder = fileSDK.getAbsPath('ecars');
let manifestJson;

const syncCloser = (initialProgress, percentage, totalSize = contentImportData.contentSize) => {
  initialProgress = initialProgress ? initialProgress : contentImportData.progress;
  let completed = 1;
  const syncData$ = new Subject<number>();
  const subscription = syncData$.pipe(throttleTime(2500)).subscribe(data => {
    let newProgress = ((completed / totalSize) * percentage);
    contentImportData.progress = initialProgress + newProgress;
    sendMessage("DATA_SYNC");
  });
  return (chunk = 0) => {
    completed += chunk;
    syncData$.next(completed);
    return subscription;
  }
}

const copyEcar = async () => {
  try {
    process.send({message: "LOG", logType: "info", logBody: [contentImportData._id, 'copping ecar from src location to ecar folder', contentImportData.ecarSourcePath, ecarFolder] });
    const syncFunc = syncCloser(ImportProgress.COPY_ECAR, 25);
    const toStream = fs.createWriteStream(path.join(ecarFolder, contentImportData._id + '.ecar'));
    const fromStream = fs.createReadStream(contentImportData.ecarSourcePath);
    fromStream.pipe(toStream);
    fromStream.on('data', buffer => syncFunc(buffer.length));
    toStream.on('finish', data => {
      syncFunc().unsubscribe();
      contentImportData.progress = ImportProgress.PARSE_ECAR
      sendMessage(ImportSteps.copyEcar)
    });
    toStream.on('error', err => { 
      syncFunc().unsubscribe(); 
      sendMessage("IMPORT_ERROR", getErrorObj(err, "UNHANDLED_COPY_ECAR_ERROR"))
    });
    fromStream.on('error', err => { 
      syncFunc().unsubscribe(); 
      sendMessage("IMPORT_ERROR", getErrorObj(err, "UNHANDLED_COPY_ECAR_ERROR"))
    })
  } catch (err) {
    sendMessage("IMPORT_ERROR", getErrorObj(err, "UNHANDLED_COPY_ECAR_ERROR"))
  }
}

const parseEcar = async () => {
  try {
    let ecarBasePath = path.join(ecarFolder, contentImportData._id + '.ecar');
    let contentBasePath = path.join(contentFolder, contentImportData._id); // temp path
    zipHandler = await loadZipHandler(ecarBasePath).catch(handelError('LOAD_ECAR'));
    await fileSDK.mkdir(path.join('content', contentImportData._id));
    const ecarContentEntries = zipHandler.entries();
    const manifestEntry = ecarContentEntries['manifest.json'] || ecarContentEntries['/manifest.json'];
    if (!manifestEntry) {
      throw getErrorObj({ message: "manifest.json is missing in ecar" }, "MANIFEST_MISSING");
    }
    await extractFile(zipHandler, getDestFilePath(manifestEntry, contentImportData._id))
    manifestJson = await fileSDK.readJSON(path.join(contentBasePath, 'manifest.json'))
    let parent = _.get(manifestJson, 'archive.items[0]');
    if (_.get(parent, 'visibility') !== 'Default') {
      throw getErrorObj({ message: `manifest.json dosn't contain content with visibility Default` }, "INVALID_MANIFEST");
    }
    if (parent.compatibilityLevel > config.get("CONTENT_COMPATIBILITY_LEVEL")) {
      throw getErrorObj({ message: `${parent.compatibilityLevel} not supported. Required ${config.get("CONTENT_COMPATIBILITY_LEVEL")} and below` }, "UNSUPPORTED_COMPATIBILITY_LEVEL");
    }
    contentImportData.contentId = parent.identifier;
    contentImportData.mimeType = parent.mimeType;
    contentImportData.pkgVersion = _.toString(parent.pkgVersion) || '1.0';
    if (contentImportData.mimeType === 'application/vnd.ekstep.content-collection') {
      contentImportData.childNodes = _.filter(_.get(manifestJson, 'archive.items'),
        item => (item.mimeType !== 'application/vnd.ekstep.content-collection'))
        .map(item => item.identifier)
    }
    contentImportData.progress = ImportProgress.EXTRACT_ECAR;
    sendMessage(ImportSteps.parseEcar)
  } catch (err) {
    sendMessage("IMPORT_ERROR", getErrorObj(err, "UNHANDLED_PARSE_ECAR_ERROR"))
  }
}

const extractEcar = async () => {
  try {
    const dbRootContent = _.find(dbContents, { identifier: contentImportData.contentId })
    if (dbRootContent) {
      // TODO: if content already exist in app 
      // 1.check compatibility level and content version, if ecar has higher level then update 
      // 2.content version of childNodes of collection if update available update content
      // 3.new ecar has more content that imported ecar in app, add those missing content to app
      sendMessage(ImportSteps.complete)
      return;
    }
    let ecarBasePath = path.join(ecarFolder, contentImportData._id + '.ecar');
    await fileSDK.mkdir(path.join('content', contentImportData.contentId));
    if (!zipHandler) {
      zipHandler = await loadZipHandler(ecarBasePath).catch(handelError('LOAD_ECAR'));
    }
    let contentMap = {};
    let artifactToBeUnzipped = [];
    let artifactToBeUnzippedSize = 0;
    if(!manifestJson){
      manifestJson = await fileSDK.readJSON(path.join(path.join(contentFolder, contentImportData._id), 'manifest.json')).catch(handelError('READ_MANIFEST_JSON'))
    }
    _.get(manifestJson, 'archive.items').forEach(item => contentMap[item.identifier] = item); // maps all content to object
    const syncFunc = syncCloser(ImportProgress.EXTRACT_ECAR ,65);
    if(contentImportData.mimeType === 'application/vnd.ekstep.content-collection' && contentImportData.childNodes){
      for(const childContent of contentImportData.childNodes){
        await extractFile(zipHandler, {
          isDirectory: true,
          destRelativePath: path.join('content', childContent)
        }).catch(handelError('EXTRACT_ECAR_CONTENT'));
      }
    }
    for (const entry of _.values(zipHandler.entries()) as any) {
      syncFunc(entry.compressedSize);
      if (!contentImportData.extractedEcarEntries[entry.name]) {
        const pathObj = getDestFilePath(entry, contentImportData.contentId, contentMap);
        if (entry.name.endsWith('.zip')) {
          artifactToBeUnzippedSize += entry.compressedSize;
          artifactToBeUnzipped.push({ 
            src: path.join(pathObj.destRelativePath, path.basename(entry.name)),
            size: entry.compressedSize
          });
        }
        await extractFile(zipHandler, pathObj).catch(handelError('EXTRACT_ECAR_CONTENT'));
        contentImportData.extractedEcarEntries[entry.name] = true;
      }
    }
    syncFunc().unsubscribe();
    process.send({message: "LOG", logType: "info", logBody: [contentImportData._id, 'ecar extracted']})
    await unzipArtifacts(artifactToBeUnzipped, artifactToBeUnzippedSize).catch(handelError('EXTRACT_ARTIFACTS'));
    removeFile(path.join('ecars', contentImportData._id + '.ecar'));
    removeFile(path.join('content', contentImportData._id));
    process.send({message: "LOG", logType: "info", logBody: [contentImportData._id, 'artifacts unzipped']})
    contentImportData.progress = ImportProgress.PROCESS_CONTENTS;
    sendMessage(ImportSteps.extractEcar)
  } catch (err) {
    sendMessage("IMPORT_ERROR", getErrorObj(err, "UNHANDLED_EXTRACT_ECAR_ERROR"))
  } finally {
    zipHandler.close && zipHandler.close();
  }
}
const removeFile = (location) => {
  fileSDK.remove(location)
    .catch(err => process.send({message: "LOG", logType: "error", logBody: [contentImportData._id, 'error while deleting ecar folder', location]}))
}
const unzipFile = async (src, dest = path.dirname(src)) => {
  await fileSDK.unzip(src, dest, false)
    .catch(err => process.send({message: "LOG", logType: "error", logBody: [contentImportData._id, 'error while unzip file', src]}))

}
const unzipArtifacts = async (artifactToBeUnzipped = [], artifactToBeUnzippedSize) => {
  const syncFunc = syncCloser(ImportProgress.EXTRACT_ARTIFACT, 9, artifactToBeUnzippedSize);
  for (const artifact of artifactToBeUnzipped) {
    syncFunc(artifact.size)
    if (!contentImportData.artifactUnzipped[artifact.src]) {
      await unzipFile(artifact.src);
      removeFile(artifact.src);
      contentImportData.artifactUnzipped[artifact.src] = true;
    }
  }
  syncFunc().unsubscribe();
}
const getDestFilePath = (entry, id, contentMap = {}) => {
  let patObj = {
    isDirectory: entry.isDirectory,
    src: entry.name,
    dest: path.join(contentFolder, id),
    destRelativePath: path.join('content', id)
  }
  const splitPath = _.union(_.compact(entry.name.split('/')));
  splitPath.forEach((content: string) => {
    let contentMapped = contentMap[content];
    if (contentMapped) {
      if (contentMapped.mimeType !== 'application/vnd.ekstep.content-collection') {
        patObj.dest = path.join(contentFolder, content);
        patObj.destRelativePath = path.join('content', content);
        return patObj;
      } else {
        if(content === id){ // extract parent content to root dir
          patObj.dest = path.join(contentFolder, content);
          patObj.destRelativePath = path.join('content', content);
        } else {
          patObj.dest = path.join(contentFolder, id, content);
          patObj.destRelativePath = path.join('content', id, content);
        }
      }
    }
  });
  return patObj;
}
const extractFile = (zipHandler, pathDetails) => {
  return new Promise(async (resolve, reject) => {
    if (pathDetails.isDirectory) {
      return await fileSDK.mkdir(pathDetails.destRelativePath).then(() => resolve()).catch((err) => {
        if(err.code === 'EEXIST'){
          resolve()
        } else {
          reject(err);
        }
      });
    }
    zipHandler.extract(pathDetails.src, pathDetails.dest, (err, count) => {
      if (err) {
        return reject(err)
      }
      resolve(count)
    });
  })
}
const loadZipHandler = async (path) => {
  const zip = new StreamZip({ file: path, storeEntries: true, skipEntryNameValidation: true });
  return new Promise((resolve, reject) => {
    zip.on('ready', () => resolve(zip));
    zip.on('error', reject);
  })
}
const sendMessage = (message: string, err?: ErrorObj) => {
  const messageObj: any = {
    message,
    contentImportData,
  }
  if(err){
    messageObj.err = err;
  }
  process.send(messageObj)
}
process.on('message', (data) => {
  if (_.includes([ImportSteps.copyEcar, ImportSteps.parseEcar, ImportSteps.extractEcar], data.message)) {
    contentImportData = data.contentImportData;
  }
  if (data.message === ImportSteps.copyEcar) {
    copyEcar()
  } else if (data.message === ImportSteps.parseEcar) {
    parseEcar()
  } else if (data.message === ImportSteps.extractEcar) {
    dbContents = data.dbContents;
    extractEcar();
  } else if (data.message === "KILL") {
    sendMessage("DATA_SYNC_KILL");
  }
});
