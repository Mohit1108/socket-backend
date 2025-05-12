const admin = require('firebase-admin');
const fs = require('fs');
const path = '/etc/secrets/firebase-service-account.json';

if (!fs.existsSync(path)) {
  throw new Error('❌ Firebase service account file not found!');
}

const serviceAccount = JSON.parse(fs.readFileSync(path, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();
module.exports = db;
