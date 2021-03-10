// Load dependencies
const fs = require("fs");
const settings = require("./UELogParserSettings.json");
const colors = require("colors");

// JSDoc definitions

/**
 * @typedef LogObject A collection of pertinent information for a specific log
 * @type {Object}
 * 
 * @property {string} category The Log category the log is coming from
 * @property {string} type The type of message being displayed, usually display, verbose, warning or error 
 * @property {string} message The message that was output to the console
 * @property {string} logText The original log text scraped from the file
 * @property {number} count How many times this log has appeared
 * @property {Array.<string>} siblings Log Texts which have been identified as identical to this log
 */

/**
 * @typedef LogInfo
 * @type {Object}
 * 
 * @property {number} totalCount Number of logs parsed
 * @property {Array.<LogObject>} uniqueList Set of unique log entries
 * @property {Object.<string,number>} categories Tracks the occurences of each category
 * @property {Object.<string,number>} typeCounts Tracks the occurences of each type
 * @property {Array.<LogInfo} dataList List of separate logInfo from each file
 * @property {string} [sourceFile] Optional field for the file which supplied the data
 */

console.clear();



// ========================= Global Variables =========================

/** The path to folder with the logs */
let pathToFolder = settings.textLoading.folderPath;

/** the write stream for printing to a file */
let outputStream;
if(settings.writeToFile) outputStream = fs.createWriteStream(__dirname + "\\UELogParser_Output.txt"); 

/** Object which contains modified logging methods */
const logger = {
    empty: (printToConsole = true) => {
        if(settings.writeToFile) outputStream.write("\n");
        if(printToConsole) console.log();
    },
    header: (text, newLine = false, printToConsole = true) => {
        const string = ( newLine ? "\n" : "") + "----- ".green + text.green + " -----".green;
        if(settings.writeToFile) outputStream.write(( newLine ? "\n" : "") + "----- " + text + " -----" + "\n");
        if(printToConsole) console.log(string);
    },
    log: (text, printToConsole = true)=>{
        const string = (typeof(text) === "string" ? text : JSON.stringify(text,null,"\t")).cyan;
        if(settings.writeToFile) outputStream.write((typeof(text) === "string" ? text : JSON.stringify(text,null,"\t")) + "\n");
        if(printToConsole) console.log(string);
    },
    debug: (text, printToConsole = true) =>{
        if(settings.debug){
            const string = (typeof(text) === "string" ? text : JSON.stringify(text,null,"\t"));
            if(printToConsole){
                console.debug(string.magenta);
            }
            if(settings.writeToFile){
                outputStream.write(string);
            }
        }
    },
    warn: (text, printToConsole = true)=>{
        const string = "Warning:".bgYellow.black + " ".yellow + (typeof(text) === "string" ? text : JSON.stringify(text,null,"\t")).yellow;
        if(settings.writeToFile) outputStream.write("Warning:" + " " + (typeof(text) === "string" ? text : JSON.stringify(text,null,"\t")) + "\n");
        if(printToConsole) console.log(string);
    },
    error: (text)=>{
        const string = "ERROR!".bgRed.black + " ".yellow + (typeof(text) === "string" ? text : JSON.stringify(text,null,"\t")).red;
        if(settings.writeToFile) outputStream.write("ERROR!" + " " + (typeof(text) === "string" ? text : JSON.stringify(text,null,"\t")) + "\n");
        if(printToConsole) console.log(string);
    }
};

/** Map of fileName to text content */
const textContent = {};

/** 
 * @type {LogInfo} 
 */
const logData = {
    totalCount: 0,
    uniqueList: [],
    categories: {},
    typeCounts: {
        errors: 0,
        warnings: 0,
        verbose: 0, 
        general: 0      
    },
    dataList: []
};

/**
 * @type {Array.<string>}
 */
const miscellaneous = [];

// ========================= Function Definitions =========================

/**
 * @function parseText
 * @description Takes a large block of text and breaks it down into individual log statements, before parsing them into data containers
 * 
 * @see {LogObject}
 * 
 * @param {String} input Text input from a log file
 * 
 * @returns {LogInfo}
 */
function parseText(input, fileName){
    logger.header(`Parsing text` + (fileName ? (" " + fileName) : ""), true);

    const logRegex = /Log.*:.*/gm;
    const parseRegex = /(?:Log(?<logCategory>[^:]+)):{1}\s*(?:(?<type>[^:-\s]*):{1}(?!:)\s*)?(?<message>.*)/;
    const matchArray = input.match(logRegex);
    
    for(let i = 0; i < matchArray.length; i++){
        const logString = matchArray[i];
        const parsedLog = logString.match(parseRegex)?.groups;
        
        if(parsedLog == null){
            matchArray[i] = {
                cateogry: undefined,
                type: undefined,
                message: undefined,
                logText: logString,
                count: 1,
                siblings: []
            }
        }
        else{
            matchArray[i] = {
                category: parsedLog?.logCategory?.trim(),
                type: parsedLog?.type?.trim(),
                message: parsedLog?.message?.trim(),
                logText: logString,
                count: 1,
                siblings: []
            };
        }

        // Print warnings for edge cases
        if(matchArray[i].category === undefined || matchArray[i].message === undefined){
            let output = "Match has missing fields ";
            if(matchArray[i].category === undefined && matchArray[i].message === undefined) output += "Category and Message"; 
            else if(matchArray[i].category === undefined) output += "Category";
            else if(matchArray[i].message === undefined) output += "Message";

            logger.warn(output);
            logger.log(matchArray[i]?.logText?.yellow);
        }
    }
    
    logger.log(`File of ${input.length} characters was parsed into ${matchArray.length} log statements`);

    const logInfo = processParsedLog(matchArray, fileName);
    if(settings.textParsing.summarize) getParseSummary(logInfo);

    return logInfo;
}

/**
 * @function processParsedLog
 * @description Turns an array of log objects into a log info object
 * 
 * @param {Array.<LogObject>} matchArray 
 * @param {string} [fileName] 
 * 
 * @returns {LogInfo}
 */
function processParsedLog(matchArray, fileName){
    // Initialize the "pointer" of loginfo
    let logInfo;
    if(settings.textParsing.consolidate){
        logInfo = logData;
        logInfo.totalCount += matchArray.length;
    }
    else{
        logInfo = {
            totalCount: matchArray.length,
            uniqueList: [],
            categories: {
                general: 0
            },
            typeCounts: {
                general: 0,
                verbose: 0,
                warnings: 0,
                errors: 0
            }
        };
    }
    
    // Process each match individually
    for(let i = 0; i < matchArray.length; i++){
        const info = matchArray[i];

        const firstIndex = logInfo.uniqueList.findIndex((data) => data.logText.replace(/\[[^\[\]]*\]\[[^\[\]]*\]\s*(?=Log)/,"") === info.logText);
        if(firstIndex === -1){
            logInfo.uniqueList.push(info);
        }
        else{
            logInfo.uniqueList[firstIndex].count++;
            logInfo.uniqueList[firstIndex]?.siblings?.push(info.logText);
        }

        if(Object.keys(logInfo.categories).includes(info.category)){
            logInfo.categories[info.category]++;
        }
        else if(info.category){
            logInfo.categories[info.category] = 1;
        }
        else{
            logInfo.general++;
        }

        // Run validation checks
        if(info.type && info.type.match(/^[\w\s]*$/) === null){
            logger.error(`Invalid type of ${info.type} on log \n ${info.logText} \n`);
            logger.log(info);
        }
    }

    for(const info of logInfo.uniqueList){
        if(info.type === "Error"){
            logInfo.typeCounts.errors++;
        }
        else if(info.type === "Warning"){
            logInfo.typeCounts.warnings++;
        }
        else if(info.type){
            const modifiedType = info.type.trim().toLowerCase();
            if(Object.keys(logInfo.typeCounts).includes(modifiedType)) {
                logInfo.typeCounts[modifiedType]++;
            }
            else{
                logInfo.typeCounts[modifiedType] = 1;
            }
        }
    }

    // Run data validation
    if(logInfo.uniqueList.length != Object.values(logInfo.typeCounts).reduce((aggr, next) => aggr+next, 0)) logger.warn("type counts do not total ");

    if(!settings.textParsing.consolidate){
        logData.dataList.push(logInfo);
        if(fileName) logInfo.sourceFile = fileName;
    }
    return logInfo;
}

/**
 * 
 * @param {Array<LogObject>} uniqueList
 * 
 * @returns {void}
 */
function sortLogsByCount(uniqueList){
    /** Takes element at right index as pivot and places the pivot in its sorted position */
    const partition = (list, start, end, comparer = (a,b) => a <= b) => {
        const pivot = list[end];
        let pIndex = start;
        
        for(let idx = start; idx < end; idx++){
            if(comparer(list[idx],pivot)){    
                [list[idx], list[pIndex]] = [list[pIndex], list[idx]];
                pIndex++;
            }
        }

        [list[pIndex], list[end]] = [list[end], list[pIndex]];
        return pIndex;
    } 
    
    /** Calculates the partition index and recursively sorts to the left and right of it */
    const quickSort = (list, start, end, comparer = (a,b) => a <= b) => {
        if(start >= end){
            return;
        }

        let pivotIndex = partition(list, start, end, comparer);
        quickSort(list, start, pivotIndex - 1);
        quickSort(list, pivotIndex + 1, end);
    }

    // For whatever reason, JS refuses to properly compare object keys, so group up log objects by count
    const numberArray = [];
    const countMap = {};
    for(const log of uniqueList){
        if(!numberArray.includes(log.count)){
            numberArray.push(log.count);
            countMap[log.count] = [log];
        }
        else{
            countMap[log.count].push(log);
        }
    }

    let debugString = uniqueList.map(item => item.count).reduce((aggr,item) => aggr +","+item);
    logger.debug(debugString);
    logger.empty();
    
    // Sort on the array of counts observed, then replace the counts with the arrays of log objects which have those counts
    quickSort(numberArray, 0, numberArray.length - 1);
    let newArray = [];
    for(const count of numberArray){
        newArray = newArray.concat(countMap[count]);
    }
    
    debugString = uniqueList.map(item => item.count).reduce((aggr,item) => aggr +","+item);
    logger.debug(debugString + "\n");

    // Run validation
    let counter = 0;
    for(let vidx = 0; vidx < uniqueList.length -1; vidx++){
        if(uniqueList[vidx].count > uniqueList[vidx + 1].count){
            counter++;
            // logger.warn(`Log ${uniqueList[vidx].message} (${uniqueList[vidx].count}) was marked greater than ${uniqueList[vidx + 1].message} (${uniqueList[vidx + 1].count})`);
        }
    }
    if(counter > 0){
        // JS is fucking stupid and the only way it sorts correctly in the main execution is if it doesn't here
        // logger.warn(`List was sorted with approximately ${counter} elements out of place`);
    }
    else{
        logger.log("Unique List was sorted successfully");
    }

    return newArray;
}

/**
 * 
 * @param {Object} logInfo 
 */
function getParseSummary(logInfo){
    logger.log(`${logInfo.uniqueList.length} unique entries ranging from counts of ${logInfo.uniqueList.reduce((prev, next) => next.count >= prev.count ? next : prev).count} to ${logInfo.uniqueList.reduce((prev, next) => next.count <= prev.count ? next : prev).count}`);
    logger.empty();

    for(const type of Object.keys(logInfo.typeCounts)){
        let printFunction = logger.log;
        printFunction(`${logInfo.typeCounts[type]} ${type}`);
    }

    logger.empty();    
    for(const category of Object.entries(logInfo.categories)){
        logger.log(`${category[0]} was logged to ${category[1]} times`);
    }
}

/**
 * 
 * @param {Array.<string>} fileNames  
 */
function loadText(fileNames){
    logger.header("Loading files", true);
    
    for(const fileName of fileNames){ 
        const path = getPathToFile(fileName);

        // Load text from file path
        logger.log(`Loading File ${path}...`);
        textContent[fileName] = fs.readFileSync(path, "utf-8");
    }
}

function getPathToFile(fileName){
    if(settings.textLoading.directory === "local"){
        return __dirname + "\\" + fileName;
    }
    else if(settings.textLoading.directory === "folder"){
        return pathToFolder + "\\" + fileName;
    }
}

/**
 * 
 * @param {LogObject} log 
 */
function filterLog(log){
    // Filter type
    if(!settings.display.filters.type.ignore){
        if(log.type === undefined && !settings.display.filters.type.allowUndefined){
            return true;
        }
        if(!settings.display.filters.type.whitelist.includes(log.type)
            || settings.display.filters.type.blacklist.includes(log.type)){
            return true;
        }
    }

    // Filter Category
    if(!settings.display.filters.category.ignore){
        if(log.category === undefined && !settings.display.filters.category.allowUndefined){
            return true;
        }
        if(!settings.display.filters.category.whitelist.includes(log.category)
            || settings.display.filters.category.blacklist.includes(log.category)){
            return true;
        }
    }

    // Default to displaying the log
    return false;
}

/**
 * 
 * @param {LogObject} log 
 * @returns {string}
 */
function getLogDisplayString(log){
    return `${log.message}
    Count: ${log.count}
    Type: ${log.type}
    Category: ${log.category}
    Original: ${log.logText} 
`;
}

/**
 * 
 * @param {Array.<LogObject>} logList
 * 
 * @returns {LogInfo} 
 */
function filterLogList(logList){
    /** @type {LogInfo} */
    let newInfo = {
        totalCount: 0,
        uniqueList: [],
        categories: {},
        typeCounts: {
            errors: 0,
            warnings: 0,
            verbose: 0, 
            general: 0      
        }
    };

    for(const log of logList){
        if(!filterLog(log)){
            newInfo.uniqueList.push(log);
            newInfo.totalCount += log.count;
            
            // Update type counts
            if(log.type === "Error"){
                newInfo.typeCounts.errors++;
            }
            else if(log.type === "Warning"){
                newInfo.typeCounts.warnings++;
            }
            else if(log.type){
                const modifiedType = log.type.trim().toLowerCase();
                if(Object.keys(logInfo.typeCounts).includes(modifiedType)) {
                    logInfo.typeCounts[modifiedType] += log.count;
                }
                else{
                    logInfo.typeCounts[modifiedType] = log.count;
                }
            }
            
            // Update category counts
            if(newInfo.categories[log.category]) newInfo.categories[log.category] += log.count;
            else newInfo.categories[log.category] = log.count;
        }
    }

    return newInfo;
}

/**
 * 
 */
function run(fileList){
    if(!fileList || fileList.length == 0){
        logger.warn("No files found");
        return;
    }

    // Scrape files for strings
    loadText(fileList, settings.textLoading);
    logger.empty();

    // Parse each file
    for(const fileName of fileList){
        if(fs.existsSync(getPathToFile(fileName))){
            parseText(textContent[fileName], fileName);
        }else{
            logger.error(`Path to file ${fileName} could not be found`);
        }
    }

    // Sort unique list by count
    if(settings.textParsing.consolidate){
        logData.uniqueList = sortLogsByCount(logData.uniqueList);
    }
    else{
        for(const data of logData.dataList){
            data.uniqueList = sortLogsByCount(data.uniqueList);
        }
    }

    logger.empty();
    logger.log("Processing finished.");
    logger.empty();

    if(settings.textParsing.consolidate){
        const data = filterLogList(logData.uniqueList);
        logger.header(`Log Data`, true);

        logger.log(`Log Count: ${data.totalCount}`);
        logger.log(`Unique Log Count: ${data.uniqueList.length}`);
        
        logger.header("Log Types", true);
        const typeEntries = Object.entries(data.typeCounts).map((value, index) => `${value[0]}: ${value[1]}`);
        if(typeEntries.length > 0){
            const typeString = typeEntries.reduce((aggr, current, index, array) => aggr + ", " + current)
            logger.log(typeString);
        }

        logger.header("Log Categories", true);
        const categoryEntries = Object.entries(data.categories).filter(category => settings.display.filters.category.ignore || (settings.display.filters.category.whitelist.includes(category) && !settings.display.filters.category.blacklist.includes(category)) ).map((value, index) => `${value[0]}: ${value[1]}`);
        if(categoryEntries.length > 0){
            const categoryString = categoryEntries.reduce((aggr, current, index, array) => aggr + ", " + current)
            logger.log(categoryString);
        }

        logger.header("Log List", true, settings.display.logList);
        for(let i = data.uniqueList.length - 1; i >= 0; i--){
            logger.log(getLogDisplayString(data.uniqueList[i]), settings.display.logList);
        }
    }
    else{
        for(const info of logData.dataList){
            logger.header(`Log File Summary: ${info.sourceFile}`, true);

            logger.log(`Log Count: ${info.totalCount}`);
            
            logger.log("Log Types");
            const typeString = Object.entries(info.typeCounts).map((value, index) => `${value[0]}:${value[1]}`).reduce((aggr, current, index, array) => aggr + ", " + current);
            logger.log(typeString);

            logger.log("Log Categories", true);
            const categoryString = Object.entries(info.categories).map((value, index) => `${value[0]}:${value[1]}`).reduce((aggr, current, index, array) => aggr + ", " + current);
            logger.log(categoryString);
        }
        for(const info of logData.dataList){
            logger.header(`Log List: ${info.sourceFile}`, true, settings.display.logList);
            for(let logIndex = 0; logIndex < info.uniqueList.length; logIndex++){
                const log = info.uniqueList[logIndex];
                
                if(!filterLog(log)){ 
                    logger.log(
    `${log.message}
        Count: ${log.count}
        Type: ${log.type}
        Category: ${log.category}
        `, settings.display.logList
                    );
                }
            }
        }
    }
}



// ========================= Runtime Execution =========================

// Get the list of files to parse
const fileList = [];
if(settings.textLoading.directory === "local"){
    for(let i = 2; i < process.argv.length; i++){
        fileList.push(process.argv[i]);
    }
}
else if(settings.textLoading.directory === "folder"){
    logger.log(`Opening folder: ${pathToFolder}`);
    fs.readdirSync(pathToFolder, { withFileTypes: true }).forEach(file => fileList.push(file.name));
}

// Parse the files
try{
    run(fileList);
}
catch(err){
    if(outputStream?.writable) outputStream.end();
    throw err;
}