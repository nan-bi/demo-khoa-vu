import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
export function openDatabase(filename){
 if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=FAST;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','editor','reviewer','viewer')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
 CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS review_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL);
 INSERT OR IGNORE INTO review_state VALUES(1,0,'{"version":1,"revision":0,"items":{}}');
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT NOT NULL,user_id INTEGER REFERENCES users(id),username TEXT NOT NULL,action TEXT NOT NULL,revision INTEGER,detail TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_audit_time ON audit(time DESC);
 PRAGMA user_version=1;`);return db;
}
export const transaction=(db,fn)=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}};
export function audit(db,user,action,detail={},revision=null){db.prepare('INSERT INTO audit(time,user_id,username,action,revision,detail) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(),user?.id??null,user?.username||'system',action,revision,typeof detail==='string'?detail:JSON.stringify(detail));}
