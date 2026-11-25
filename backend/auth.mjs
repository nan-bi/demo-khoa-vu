import {scryptSync,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {audit,transaction} from './database.mjs';
export const ROLES=['admin','editor','reviewer','viewer'];
export const hashToken=token=>createHash('sha256').update(token).digest('hex');

export function validatePassword(password){
 if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Mật khẩu cần 12–256 ký tự.');
 if(password.trim().length<12)throw Error('Mật khẩu không được chỉ gồm khoảng trắng.');
 const hasLower=/[a-z]/.test(password);
 const hasUpper=/[A-Z]/.test(password);
 const hasDigit=/[0-9]/.test(password);
 const hasSpecial=/[^a-zA-Z0-9]/.test(password);
 const classes=[hasLower,hasUpper,hasDigit,hasSpecial].filter(Boolean).length;
 if(classes<2)throw Error('Mật khẩu cần kết hợp ít nhất 2 nhóm: chữ thường, chữ hoa, số hoặc ký tự đặc biệt.');
 return true;
}

export function hashPassword(password){
 const salt=randomBytes(16).toString('hex');
 const hash=scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024}).toString('hex');
 return `${salt}:${hash}`;
}

export function verifyPassword(password,passwordHash){
 if(typeof password!=='string'||password.length>256)return false;
 const [salt,hash]=(passwordHash||`${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
 const actual=scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024}),expected=Buffer.from(hash,'hex');
 return timingSafeEqual(actual,expected);
}

export function createUser(db,{username,password,role='viewer'},performedBy=null){
 if(!/^[a-zA-Z0-9_.-]{3,64}$/.test(username||''))throw Error('Tên đăng nhập cần 3–64 ký tự chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.');
 validatePassword(password);
 if(!ROLES.includes(role))throw Error('Vai trò không hợp lệ.');
 const passwordHash=hashPassword(password);
 return transaction(db,()=>{
  const result=db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)').run(username,passwordHash,role,new Date().toISOString());
  const user={id:Number(result.lastInsertRowid),username,role};
  audit(db,performedBy||user,'USER_CREATED',{role,createdUsername:username});
  return user;
 });
}

export function authenticate(db,username,password){
 if(typeof username!=='string'||typeof password!=='string'||password.length>256)return null;
 const user=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
 const match=verifyPassword(password,user?.password_hash);
 if(!match||!user)return null;
 return {id:user.id,username:user.username,role:user.role};
}

export function createSession(db,user){
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex'),expires=Date.now()+8*60*60*1000;
 db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken(token),user.id,csrf,expires);
 return {token,csrf,expires,user};
}

export function getSession(db,cookie=''){
 const token=cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('vinmec_session='))?.slice(15);
 if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 const row=db.prepare('SELECT users.id,users.username,users.role,sessions.csrf,sessions.expires_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND users.active=1').get(hashToken(token),Date.now());
 return row?{token,user:{id:row.id,username:row.username,role:row.role},csrf:row.csrf,expires:row.expires_at}:null;
}

export function revokeUserSessions(db,userId){
 db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

export function changePassword(db,userId,newPassword,performedBy=null){
 validatePassword(newPassword);
 return transaction(db,()=>{
  const user=db.prepare('SELECT id,username FROM users WHERE id=?').get(userId);
  if(!user)throw Error('Không tìm thấy người dùng.');
  const passwordHash=hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,userId);
  revokeUserSessions(db,userId);
  audit(db,performedBy||user,'PASSWORD_CHANGED',{targetUserId:userId,targetUsername:user.username});
  return {ok:true};
 });
}

export function setUserActive(db,userId,active,performedBy=null){
 return transaction(db,()=>{
  const user=db.prepare('SELECT id,username FROM users WHERE id=?').get(userId);
  if(!user)throw Error('Không tìm thấy người dùng.');
  const status=active?1:0;
  db.prepare('UPDATE users SET active=? WHERE id=?').run(status,userId);
  if(status===0)revokeUserSessions(db,userId);
  audit(db,performedBy||user,'USER_STATUS_CHANGED',{targetUserId:userId,targetUsername:user.username,active:status});
  return {ok:true,active:status};
 });
}

export function setUserRole(db,userId,role,performedBy=null){
 if(!ROLES.includes(role))throw Error('Vai trò không hợp lệ.');
 return transaction(db,()=>{
  const user=db.prepare('SELECT id,username FROM users WHERE id=?').get(userId);
  if(!user)throw Error('Không tìm thấy người dùng.');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role,userId);
  revokeUserSessions(db,userId);
  audit(db,performedBy||user,'USER_ROLE_CHANGED',{targetUserId:userId,targetUsername:user.username,role});
  return {ok:true,role};
 });
}
