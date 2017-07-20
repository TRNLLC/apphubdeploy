#!/usr/bin/env ts-node
import fs = require('fs');
const pkg = require('./package.json');
import path = require('path');
import * as program from 'commander';

/** Use on the CLI only */

const main = (argc: number, argv: Array<string>): number => {
  try {
    program
      .version(pkg.version)
      .option('-a, --app-versions <app-versions>',     'App Versions separated by commas that are compatible with this build. Either do not use a space in between version or wrap it in quotes. Example: -a 1.0.3,1.0.4 Defaults to value in info.plist of build file.' )
      .option('-d, --build-description <description>', 'Description of the build. Wrap in quotes if more than one word.')
      .option('-e, --entry-file <entry-file>',         'The entry file for your application e.g. `index.ios.js` passed into `apphub build`.')
      .option('-o, --open-build-url',                  'Open AppHub Builds URL after a successful build and deploy.')
      .option('-n, --build-name <name>',               'Name of the build. Wrap in quotes if more than one word.')
      .option('-p, --plist-file <plist-file>',         'Use a custom plist file path in the `apphub build` command.')
      .option('-r, --retain-build',                    'Do not remove the build after a successful deploy. By default it will be removed.')
      .option('-t, --target <target>',                 'One of [all, debug, none] which specifies the target audience of the build. Defaults to none.')
      .option('-v, --verbose',                         'Unleashes the "Chatty Kathy" to the STDOUT - great for debugging!')
      .parse(argv);
    
    let retValue = 0;
    if ((retValue = ApphubDeploy.checkOptionValues())) return retValue;

    if ((retValue = ApphubDeploy.readPreviouslySavedAppHubCredentials())) return retValue;

    ApphubDeploy.setBuildUrl();

    if ((retValue = ApphubDeploy.build())) return retValue;

    if ((retValue = ApphubDeploy.deploy())) return retValue;

    if (!program.retainBuild)
      ApphubDeploy.removeBuildFile();

    return 0;
  } catch (error) {
    console.error(error);
    return 1;
  }

}

namespace ApphubDeploy {

let APP_HUB_ID = ''
let APP_HUB_SECRET = '';
let BUILD_FILE_NAME = 'AppHubBuild_' + Date.now() + '.zip';
let BUILD_FILE_PATH = path.resolve('./', BUILD_FILE_NAME);
let BUILD_URL_BASE  = 'https://dashboard.apphub.io/projects/';
let BUILD_URL = '';

export const setBuildUrl = () => {
  BUILD_URL = BUILD_URL_BASE + APP_HUB_ID;
}

export const checkOptionValues = () => {
  const permittedValues = ["all", "debug", "none"];

  if (program.target && !permittedValues.includes(program.target)) {
    console.log('-t --target option needs to be one of ' + permittedValues.join(", ") + '.');
    console.log('');
    return 1;
  } else {
    return 0;
  }
}

export const readPreviouslySavedAppHubCredentials = () => {
    // If run without any .apphub file then run setup.
  let appHubData: { appHubId: string, appHubSecret: string };
  try {
    let appHubFileData = fs.readFileSync('./.apphub', 'utf-8');
    appHubData = JSON.parse(appHubFileData);

    // If .apphub exists, try and get values.
    if (!appHubData.appHubId.trim() || !appHubData.appHubSecret.trim())
      throw new Error('One or both of your AppHub credentials are blank');

    // .apphub file exists, can be read and the credentials are reasonable (i.e. present and not blank).
    if (program.verbose)
      console.log('Found .apphub file! Reading credentials.');

    APP_HUB_ID     = appHubData.appHubId;
    APP_HUB_SECRET = appHubData.appHubSecret;
    return 0;
  } catch (error) {
    console.error(error);
    return 1;
  }
}

export const build = () => {
  console.log('');
  process.stdout.write('Building... ');
  
  let appHubBuildOptions = ["--verbose"]
  if (program.plistFile) { appHubBuildOptions.push("--plist-file " + program.plistFile) }
  if (program.entryFile) { appHubBuildOptions.push("--entry-file " + program.entryFile) }
  if (program.target == "debug") { appHubBuildOptions.push("--dev") }
  appHubBuildOptions.push("--output-zip " + BUILD_FILE_NAME)

  const buildResult = require('child_process').execSync( './node_modules/.bin/apphub build ' + appHubBuildOptions.join(" ") ).toString();

  if (program.verbose) {
    console.log(buildResult);
    console.log('');
  }

  process.stdout.write('Done!');
  return 0;
}

export const deploy = () => {
  console.log('');
  process.stdout.write('Deploying... ');

  try {
    // Compile any Meta Data into an Array to be used in the cURL request.
    let metaData: {
      [key:string]: any,
      target?: string,
      name?: string,
      description?: string,
      app_versions?: string
    } = {};
    if (program.target)
      metaData['target'] = program.target;

    if (program.buildName)
      metaData['name'] = program.buildName;

    if (program.buildDescription)
      metaData['description'] = program.buildDescription;

    if (program.appVersions)
      metaData['app_versions'] = program.appVersions;

    let metaDataString = '{ ';

    Object.keys(metaData).forEach( (key, index) => {
      if (index != 0)
        metaDataString += ', ';

      metaDataString += '"' + key + '": ';

      if (key == 'app_versions') {
        metaDataString += '[';
        const value = metaData[key]
        if (value) {
          value.split(',').forEach( (appVersion, index) => {
            if (index != 0)
              metaDataString += ',';

            metaDataString += '"' + appVersion.trim() + '"';
          })
        }
        metaDataString += ']';
      }
      else {
        const value: string | undefined = metaData[key]
        if (value) {
          metaDataString += `"${value}"`;
        }
      }
    })

    metaDataString += ' }'

    let getUrlForPutCommand =  'curl -X GET';
    if (!program.verbose)
      getUrlForPutCommand += ' --silent';
    getUrlForPutCommand += ' -H "X-AppHub-Application-ID: ' + APP_HUB_ID + '"';
    getUrlForPutCommand += ' -H "X-AppHub-Application-Secret: ' + APP_HUB_SECRET + '"';
    getUrlForPutCommand += ' -H "Content-Type: application/zip"';

    // Add Meta Data if any are set with the options.
    if (metaDataString != '{  }')
      getUrlForPutCommand += ' -H \'X-AppHub-Build-Metadata: ' + metaDataString.replace(/'/g, '_') + "'";

    getUrlForPutCommand += ' -L https://api.apphub.io/v1/upload';
    getUrlForPutCommand += ' | python -c \'import json,sys;obj=json.load(sys.stdin);print obj["data"]["s3_url"]\'';

    if (program.verbose) {
      console.log('GET Command:');
      console.log(getUrlForPutCommand);
    }

    const urlForPut = require('child_process').execSync( getUrlForPutCommand ).toString().trim();

    if (program.verbose) {
      console.log('urlForPut:');
      console.log(urlForPut);
    }

    let putCommand  = 'curl -X PUT';
    if (!program.verbose)
      putCommand += ' --silent';
    putCommand += ' -H "Content-Type: application/zip"';
    putCommand += ' -L "' + urlForPut + '"';
    putCommand += ' --upload-file ' + BUILD_FILE_NAME;

    if (program.verbose) {
      console.log('putCommand:');
      console.log(putCommand);
    }

    const putResponse = require('child_process').execSync( putCommand ).toString().trim();

    if (program.verbose) {
      console.log( putResponse );
      console.log('');
    }

    process.stdout.write('Done!');



    console.log('');
    console.log('');
    console.log('SUCCESSFULLY BUILT AND DEPLOYED TO APPHUB!')
    console.log('');


    console.log('You can see your build here: ' + BUILD_URL);

      return 0;
  } catch(error) {
    console.log('');
    console.log('There was a problem uploading the build:');
    console.log(error);

    return 1;
  }
}

export const removeBuildFile = () => {
    try {
    console.log('');
    process.stdout.write('Removing Build File... ');

    if (program.verbose) {
      console.log('BUILD_FILE_PATH: ')
      console.log(BUILD_FILE_PATH);
    }

    fs.unlinkSync(BUILD_FILE_PATH)

    process.stdout.write('Done!');
    console.log('');
    console.log('');
    return 0;
  } catch(error) {
    console.log('');
    console.log('There was a problem removing the build file: ' + BUILD_FILE_PATH);
    console.log('');
    console.log(error);

    return 1;
  }
}
}


process.exit(main(process.argv.length, process.argv));


/*

let APP_HUB_ID;
let APP_HUB_SECRET;
let BUILD_FILE_NAME = 'AppHubBuild_' + Date.now() + '.zip';
let BUILD_FILE_PATH = path.resolve('./', BUILD_FILE_NAME);
let BUILD_URL_BASE  = 'https://dashboard.apphub.io/projects/';
let BUILD_URL;

program
  .version(pkg.version)
  .option('-a, --app-versions <app-versions>',     'App Versions separated by commas that are compatible with this build. Either do not use a space in between version or wrap it in quotes. Example: -a 1.0.3,1.0.4 Defaults to value in info.plist of build file.' )
  // .option('-c, --configure',                       '(Re)Configure AppHub ID and Secret key.')
  .option('-d, --build-description <description>', 'Description of the build. Wrap in quotes if more than one word.')
  .option('-e, --entry-file <entry-file>',         'The entry file for your application e.g. `index.ios.js` passed into `apphub build`.')
  .option('-o, --open-build-url',                  'Open AppHub Builds URL after a successful build and deploy.')
  .option('-n, --build-name <name>',               'Name of the build. Wrap in quotes if more than one word.')
  .option('-p, --plist-file <plist-file>',         'Use a custom plist file path in the `apphub build` command.')
  .option('-r, --retain-build',                    'Do not remove the build after a successful deploy. By default it will be removed.')
  .option('-t, --target <target>',                 'One of [all, debug, none] which specifies the target audience of the build. Defaults to none.')
  .option('-v, --verbose',                         'Unleashes the "Chatty Kathy" to the STDOUT - great for debugging!')
  .parse(process.argv);

checkOptionValues();

// if (program.configure) {
//   setup();
// }
// else {
readPreviouslySavedAppHubCredentials();
// }

let BUILD_URL = BUILD_URL_BASE + APP_HUB_ID;

build();

deploy();

if (!program.retainBuild)
  removeBuildFile();

if (program.openBuildUrl)
  openBuildUrl();

process.exit(0);




// Private Functions

function checkOptionValues() {
  permittedValues = ["all", "debug", "none"];

  if (program.target && !permittedValues.includes(program.target)) {
    console.log('-t --target option needs to be one of ' + permittedValues.join(", ") + '.');
    console.log('');
    process.exit(1);
  }
}


function readPreviouslySavedAppHubCredentials() {
  // If run without any .apphub file then run setup.
  let appHubData;
  try {
    let appHubFileData = fs.readFileSync( './.apphub' );
    appHubData = JSON.parse(appHubFileData);

    // If .apphub exists, try and get values.
    if (!appHubData.appHubId.trim() || !appHubData.appHubSecret.trim())
      throw new Error('One or both of your AppHub credentials are blank');

    // .apphub file exists, can be read and the credentials are reasonable (i.e. present and not blank).
    if (program.verbose)
      console.log('Found .apphub file! Reading credentials.');

    APP_HUB_ID     = appHubData.appHubId;
    APP_HUB_SECRET = appHubData.appHubSecret;
  }
  catch (error) {
    if (error.code == 'ENOENT') {
      // If missing file, no problem, we'll kick off the Setup function to create it.
      setup();
    }
    else {
      // console.log('The contents of .apphub file were not what we were expecting. Try running with --configure command to re-enter your AppHub credentials.');
      // console.log('');
      process.exit(1);
    }
  }
};


function build() {
  console.log('');
  process.stdout.write('Building... ');
  
  var appHubBuildOptions = ["--verbose"]
  if (program.plistFile) { appHubBuildOptions.push("--plist-file " + program.plistFile) }
  if (program.entryFile) { appHubBuildOptions.push("--entry-file " + program.entryFile) }
  if (program.target == "debug") { appHubBuildOptions.push("--dev") }
  appHubBuildOptions.push("--output-zip " + BUILD_FILE_NAME)

  buildResult = require('child_process').execSync( './node_modules/.bin/apphub build ' + appHubBuildOptions.join(" ") ).toString();

  if (program.verbose) {
    console.log(buildResult);
    console.log('');
  }

  process.stdout.write('Done!');
};

function deploy() {
  console.log('');
  process.stdout.write('Deploying... ');

  try {
    // Compile any Meta Data into an Array to be used in the cURL request.
    var metaData = {};
    if (program.target)
      metaData['target'] = program.target;

    if (program.buildName)
      metaData['name'] = program.buildName;

    if (program.buildDescription)
      metaData['description'] = program.buildDescription;

    if (program.appVersions)
      metaData['app_versions'] = program.appVersions;

    var metaDataString = '{ ';

    Object.keys(metaData).forEach( (key, index) => {
      if (index != 0)
        metaDataString += ', ';

      metaDataString += '"' + key + '": ';

      if (key == 'app_versions') {
        metaDataString += '[';

        metaData[key].split(',').forEach( (appVersion, index) => {
          if (index != 0)
            metaDataString += ',';

          metaDataString += '"' + appVersion.trim() + '"';
        })

        metaDataString += ']';
      }
      else {
        metaDataString += '"' + metaData[key] + '"';
      }
    })

    metaDataString += ' }'

    getUrlForPutCommand =  'curl -X GET';
    if (!program.verbose)
      getUrlForPutCommand += ' --silent';
    getUrlForPutCommand += ' -H "X-AppHub-Application-ID: ' + APP_HUB_ID + '"';
    getUrlForPutCommand += ' -H "X-AppHub-Application-Secret: ' + APP_HUB_SECRET + '"';
    getUrlForPutCommand += ' -H "Content-Type: application/zip"';

    // Add Meta Data if any are set with the options.
    if (metaDataString != '{  }')
      getUrlForPutCommand += ' -H \'X-AppHub-Build-Metadata: ' + metaDataString.replace(/'/g, '_') + "'";

    getUrlForPutCommand += ' -L https://api.apphub.io/v1/upload';
    getUrlForPutCommand += ' | python -c \'import json,sys;obj=json.load(sys.stdin);print obj["data"]["s3_url"]\'';

    if (program.verbose) {
      console.log('GET Command:');
      console.log(getUrlForPutCommand);
    }

    urlForPut = require('child_process').execSync( getUrlForPutCommand ).toString().trim();

    if (program.verbose) {
      console.log('urlForPut:');
      console.log(urlForPut);
    }

    putCommand  = 'curl -X PUT';
    if (!program.verbose)
      putCommand += ' --silent';
    putCommand += ' -H "Content-Type: application/zip"';
    putCommand += ' -L "' + urlForPut + '"';
    putCommand += ' --upload-file ' + BUILD_FILE_NAME;

    if (program.verbose) {
      console.log('putCommand:');
      console.log(putCommand);
    }

    putResponse = require('child_process').execSync( putCommand ).toString().trim();

    if (program.verbose) {
      console.log( putResponse );
      console.log('');
    }

    process.stdout.write('Done!');
  }
  catch(error) {
    console.log('');
    console.log('There was a problem uploading the build:');
    console.log(error);

    process.exit(1);
  }

  console.log('');
  console.log('');
  console.log('SUCCESSFULLY BUILT AND DEPLOYED TO APPHUB!')
  console.log('');

  console.log('You can see your build here: ' + BUILD_URL);

};

function removeBuildFile() {
  try {
    console.log('');
    process.stdout.write('Removing Build File... ');

    if (program.verbose) {
      console.log('BUILD_FILE_PATH: ')
      console.log(BUILD_FILE_PATH);
    }

    fs.unlinkSync(BUILD_FILE_PATH)

    process.stdout.write('Done!');
    console.log('');
    console.log('');
  }
  catch(error) {
    console.log('');
    console.log('There was a problem removing the build file: ' + BUILD_FILE_PATH);
    console.log('');
    console.log(error);

    process.exit(1);
  }
}

function openBuildUrl() {
  console.log('Opening AppHub Builds in your browser...');

  open(BUILD_URL);
};
*/