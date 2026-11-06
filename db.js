// Thin data/auth layer over Firebase. The rest of the app only talks to this file.
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, sendPasswordResetEmail, updateProfile, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, doc, collection, getDoc, setDoc, updateDoc, deleteDoc,
  addDoc, onSnapshot, query, orderBy, limit, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE_");

let auth = null, fs = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache() }); }
  catch (e) { fs = initializeFirestore(app, {}); }
}

const mapUser = u => u ? { uid: u.uid, email: u.email || "", name: u.displayName || "" } : null;

export function onAuth(cb) { if (!auth) { cb(null); return () => {}; } return onAuthStateChanged(auth, u => cb(mapUser(u))); }
export async function signIn(email, pw) { await signInWithEmailAndPassword(auth, email, pw); }
export async function signUp(email, pw, name) {
  const c = await createUserWithEmailAndPassword(auth, email, pw);
  if (name) await updateProfile(c.user, { displayName: name });
}
export async function google() { await signInWithPopup(auth, new GoogleAuthProvider()); }
export async function signOut() { await fbSignOut(auth); }
export async function resetPassword(email) { await sendPasswordResetEmail(auth, email); }
// Deletes the signed-in Firebase Auth account (Google Play requires in-app account deletion).
// Throws {code:"auth/requires-recent-login"} if the person signed in long ago.
export async function deleteAccount() { await deleteUser(auth.currentUser); }

export async function get(path) { const s = await getDoc(doc(fs, path)); return s.exists() ? Object.assign({ id: s.id }, s.data()) : null; }
export async function set(path, data) { await setDoc(doc(fs, path), data); }
export async function update(path, data) { await updateDoc(doc(fs, path), data); } // keys may be "a.b" field paths
export async function del(path) { await deleteDoc(doc(fs, path)); }
export async function add(colPath, data) { const r = await addDoc(collection(fs, colPath), data); return r.id; }
export function newId(colPath) { return doc(collection(fs, colPath)).id; }

export function listen(colPath, opts, cb, err) {
  const parts = [];
  if (opts && opts.where) parts.push(where(opts.where[0], opts.where[1], opts.where[2]));
  if (opts && opts.orderBy) parts.push(orderBy(opts.orderBy[0], opts.orderBy[1] || "asc"));
  if (opts && opts.limit) parts.push(limit(opts.limit));
  const q = parts.length ? query(collection(fs, colPath), ...parts) : collection(fs, colPath);
  return onSnapshot(q, s => cb(s.docs.map(d => Object.assign({ id: d.id }, d.data()))), e => err && err(e));
}
export function listenDoc(path, cb, err) {
  return onSnapshot(doc(fs, path), s => cb(s.exists() ? Object.assign({ id: s.id }, s.data()) : null), e => err && err(e));
}
