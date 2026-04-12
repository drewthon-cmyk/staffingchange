const { google } = require('googleapis');
const fs = require('fs');
const config = require('../config/config');

function getDriveClient() {
  const auth = new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function uploadResume(filePath, originalName, applicantName) {
  const drive = getDriveClient();

  // Find or create applicant subfolder
  const folderId = await getOrCreateFolder(drive, applicantName, config.google.driveFolderId);

  const fileMetadata = {
    name: originalName,
    parents: [folderId],
  };

  const media = {
    mimeType: 'application/pdf',
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, webViewLink',
  });

  // Make the file viewable by anyone with the link
  await drive.permissions.create({
    fileId: response.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    id: response.data.id,
    url: response.data.webViewLink,
  };
}

async function getOrCreateFolder(drive, folderName, parentId) {
  // Check if folder exists
  const res = await drive.files.list({
    q: `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
  });

  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Create it
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  return folder.data.id;
}

async function deleteFile(fileId) {
  if (!fileId) return;
  try {
    const drive = getDriveClient();
    await drive.files.delete({ fileId });
  } catch (err) {
    console.error('Failed to delete Drive file:', err.message);
  }
}

module.exports = { uploadResume, deleteFile };
