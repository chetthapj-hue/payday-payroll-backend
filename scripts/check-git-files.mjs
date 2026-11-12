import {execFileSync} from 'node:child_process';
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
const unsafe=files.filter(path=>{
 const name=path.split('/').at(-1);
 return (/^\.env(?:\.|$)/.test(name)&&name!=='.env.example') ||
  /(?:^|\/)(?:backup|backups)\//i.test(path) || /\.(?:dump(?:\..*)?|pgdump|backup|bak|pem|key)$/i.test(name) ||
  /\.sql\.(?:gz|zip|bz2|xz)$/i.test(name) || /(?:backup|dump).*\.sql$/i.test(name) || /^payday_db.*\.sql$/i.test(name);
});
if(unsafe.length)throw new Error(`Do not commit these secret/backup files:\n${unsafe.join('\n')}`);
console.log(`PASS: ${files.length} tracked/candidate files; no real .env, private key or recognized database backup is included`);
