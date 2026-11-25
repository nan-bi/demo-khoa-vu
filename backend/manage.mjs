import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './database.mjs';
import {createUser,changePassword,setUserActive,validatePassword} from './auth.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),filename=process.env.VINMEC_DB||path.join(root,'backend/data/vinmec.sqlite'),command=process.argv[2];
const db=openDatabase(filename);
async function password(prompt){
 if(!stdin.isTTY)throw Error('Cần chạy lệnh trong cửa sổ Terminal tương tác để nhập mật khẩu.');
 stdout.write(prompt);stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{let result='';const read=chunk=>{for(const ch of chunk.toString()){if(ch==='\u0003'){done();reject(Error('Đã hủy.'));return}if(ch==='\r'||ch==='\n'){done();resolve(result);return}if(ch==='\u007f'||ch==='\b'){result=result.slice(0,-1)}else if(ch>=' ')result+=ch;}};const done=()=>{stdin.off('data',read);stdin.setRawMode(false);stdin.pause();stdout.write('\n')};stdin.on('data',read)});
}
try{
 if(command==='create-user'){
  const rl=createInterface({input:stdin,output:stdout});const username=(await rl.question('Username: ')).trim(),role=(await rl.question('Role (admin/editor/reviewer/viewer): ')).trim();rl.close();
  const secret=await password('Password (12+ characters, hidden): '),confirm=await password('Repeat password: ');if(secret!==confirm)throw Error('Mật khẩu không khớp.');
  validatePassword(secret);
  const user=createUser(db,{username,password:secret,role});console.log(`Created ${user.username} (${user.role}).`);
 }else if(command==='change-password'){
  const rl=createInterface({input:stdin,output:stdout});const username=(await rl.question('Username: ')).trim();rl.close();
  const user=db.prepare('SELECT id,username FROM users WHERE username=?').get(username);
  if(!user)throw Error('Không tìm thấy người dùng: '+username);
  const secret=await password('New password (12+ chars, hidden): '),confirm=await password('Repeat new password: ');if(secret!==confirm)throw Error('Mật khẩu không khớp.');
  validatePassword(secret);
  changePassword(db,user.id,secret);console.log(`Password updated for ${user.username}. All active sessions revoked.`);
 }else if(command==='deactivate-user'){
  const username=process.argv[3];if(!username)throw Error('Cần username: node backend/manage.mjs deactivate-user <username>');
  const user=db.prepare('SELECT id,username FROM users WHERE username=?').get(username);
  if(!user)throw Error('Không tìm thấy người dùng: '+username);
  setUserActive(db,user.id,false);console.log(`User ${user.username} deactivated and all sessions revoked.`);
 }else if(command==='activate-user'){
  const username=process.argv[3];if(!username)throw Error('Cần username: node backend/manage.mjs activate-user <username>');
  const user=db.prepare('SELECT id,username FROM users WHERE username=?').get(username);
  if(!user)throw Error('Không tìm thấy người dùng: '+username);
  setUserActive(db,user.id,true);console.log(`User ${user.username} activated.`);
 }else if(command==='backup'){
  const destination=process.argv[3];if(!destination)throw Error('Cần đường dẫn file sao lưu .sqlite mới.');
  const {existsSync}=await import('node:fs');if(existsSync(destination))throw Error('File đích đã có; chọn tên mới.');
  db.prepare('VACUUM INTO ?').run(path.resolve(destination));console.log('Database backup completed.');
 }else if(command==='users'){console.table(db.prepare('SELECT id,username,role,active,created_at FROM users').all());}
 else if(command==='audit'){
  const limit=Math.min(100,Math.max(1,Number(process.argv[3])||25));
  console.table(db.prepare('SELECT id,time,username,action,revision,detail FROM audit ORDER BY id DESC LIMIT ?').all(limit));
 }
 else throw Error('Commands: create-user | change-password | deactivate-user <username> | activate-user <username> | users | audit [limit] | backup <new-file.sqlite>');
}catch(e){console.error(e.message);process.exitCode=1}finally{db.close()}
