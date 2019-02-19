const fs = require('fs')
const jsonfile = require('jsonfile')
const path = require('path')
const readline = require('readline')
const moment = require('moment')
const { google } = require('googleapis')

const config = require('./config')

const FILES_PATH = path.resolve(__dirname, 'files.json')
const COMPLETED_PATH = path. resolve(__dirname, 'completed.json')

let downloaded_files = []
try {
  downloaded_files = jsonfile.readFileSync(COMPLETED_PATH)
} catch (e) {
  console.log(e)
}

// If modifying these scopes, delete token.json.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
]
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json'

let drive

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err)
  // Authorize a client with credentials, then call the Google Drive API.
  authorize(JSON.parse(content), main)
})

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0])

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback)
    oAuth2Client.setCredentials(JSON.parse(token))
    callback(oAuth2Client)
  })
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  })
  console.log('Authorize this app by visiting this url:', authUrl)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close()
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err)
      oAuth2Client.setCredentials(token)
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) console.error(err)
        console.log('Token stored to', TOKEN_PATH)
      })
      callback(oAuth2Client)
    })
  })
}

function listFiles (pageToken) {
  return new Promise((resolve, reject) => {
    console.log('listing drive', pageToken)
    drive.files.list({
      q: `'${config.folder_id}' in parents and trashed=false`,
      pageSize: 1,
      pageToken
    }, (err, res) => {
      if (err) return reject(err)
      resolve (res)
    })
  })
}

async function listAllFiles () {
  let result = []
  let keepGoing = true
  let token = null
  let offset = 0
  while (keepGoing) {
    let res = await listFiles(token)
    const { files, nextPageToken } = res.data
    result.push.apply(result, files)
    if (!nextPageToken) keepGoing = false
    else token = nextPageToken
  }

  return result
}

/**
 * Lists the names and IDs of up to 10 files.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function main(auth) {
  drive = google.drive({version: 'v3', auth})

  try {
    // check to see if file list exists
    const file_list_exists = fs.existsSync(FILES_PATH)

    let files
    // get file list & save
    if (!file_list_exists) {
      files = await listAllFiles()
      jsonfile.writeFileSync(FILES_PATH, files, { spaces: 2 })
    } else {
      files = jsonfile.readFileSync(FILES_PATH)
    }

    console.log(`${files.length} total files`)

    // get diff
    let difference = files.filter((file) => {
      return !downloaded_files.find((downloaded_file) => {
        return downloaded_file.id = file.id
      })
    })

    console.log(`${difference.length} to be downloaded`)

    // while within time
    const start = moment().hour(0)
    const end = moment().hour(13)
    while (moment().isBetween(start, end) && difference.length) {
      const file = difference.shift()
      await downloadFile(file)
    }

  } catch (e) {
    console.log(e)
  }
}

function downloadFile(item) {
  return new Promise((resolve, reject) => {
    const filepath = path.resolve(config.dest_path, item.name)
    const dest = fs.createWriteStream(filepath)
    console.log('downloading', filepath)

    dest.on('finish', () => {
      downloaded_files.push(item)
      jsonfile.writeFileSync(COMPLETED_PATH, downloaded_files, { spaces: 2 })
      console.log('downloaded', item.name)
      resolve()
    })

    drive.files.get({
      fileId: item.id,
      alt: 'media'
    }, {
      responseType: 'stream'
    }, (err, res) => {
      res.data.on('end', function () {
        console.log('google drive download complete', item.name)
      }).on('error', function (err) {
        reject(err)
      }).pipe(dest)
    })
  })
}
