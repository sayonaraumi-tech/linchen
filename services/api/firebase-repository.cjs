'use strict';

const {FieldValue, getFirestore} = require('firebase-admin/firestore');
const {createRepository} = require('../../src/storage/firestore-repository');

function adaptSnapshot(snapshot) {
  return {id: snapshot.id, exists: () => snapshot.exists, data: () => snapshot.data()};
}

const sdk = {
  doc: (db, path) => db.doc(path),
  collection: (db, path) => db.collection(path),
  limitQuery: (ref, count) => ref.limit(count),
  getDoc: async ref => adaptSnapshot(await ref.get()),
  getDocs: ref => ref.get(),
  serverTimestamp: () => FieldValue.serverTimestamp(),
  runTransaction: (db, update) => db.runTransaction(transaction => update({
    get: async ref => adaptSnapshot(await transaction.get(ref)),
    set: (ref, value) => transaction.set(ref, value),
  })),
};

function createTrustedRepository(app, actor) {
  return createRepository({
    sdk,
    db: getFirestore(app),
    companyId: actor.companyId,
    getIdentity: async () => actor,
    writeEnabled: true,
  });
}

module.exports = {createTrustedRepository};
