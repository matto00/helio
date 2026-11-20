import fs from "fs"; import path from "path";
const HOVER="@media (hover: hover)";
const strip=c=>c.replace(/\/\*[\s\S]*?\*\//g,"");
function splitTop(s){const p=[];let d=0,c="";for(const ch of s){if(ch==="("||ch==="[")d++;if(ch===")"||ch==="]")d--;if(ch===","&&d===0){p.push(c.trim());c="";}else c+=ch;}p.push(c.trim());return p.filter(x=>x);}
function parse(css,anc=[]){const r=[];let i=0;while(i<css.length){const o=css.indexOf("{",i);if(o===-1)break;let d=1,j=o+1;while(d>0&&j<css.length){if(css[j]==="{")d++;else if(css[j]==="}")d--;j++;}const pre=css.slice(i,o).replace(/^[\s;}]+/,"").trim();const body=css.slice(o+1,j-1);if(pre.startsWith("@")){const n=pre.replace(/\s+/g," ");if(/^@(media|supports|container|layer)/.test(n))r.push(...parse(body,[...anc,n]));}else r.push({sel:splitTop(pre.replace(/\s+/g," ")),anc,body:body.trim().replace(/\s+/g," ")});i=j;}return r;}
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const f=path.join(d,e.name);return e.isDirectory()?walk(f):e.name.endsWith(".css")?[f]:[];});}
const FILL=/^(background(-color|-image)?|border(-[a-z]+)*|color|outline(-[a-z]+)*|box-shadow|filter|text-decoration(-[a-z]+)*|transform|cursor|fill|stroke|text-underline-offset|opacity-fill)$/;
const tag=body=>{const props=body.split(";").map(d=>d.split(":")[0].trim()).filter(Boolean);const non=props.filter(p=>!FILL.test(p)&&!p.startsWith("--"));return non.length?`[NON-FILL: ${non.join(",")}]`:"[FILL]";};
const root=process.argv[2];let files=0,rules=0,sels=0;const byFile={};
for(const f of walk(root+"/frontend/src").sort()){const rel=path.relative(root+"/frontend/src",f);if(rel.startsWith("shared/"))continue;
 const rs=parse(strip(fs.readFileSync(f,"utf8")));for(const r of rs){const h=r.sel.filter(s=>s.includes(":hover"));if(!h.length||r.anc.includes(HOVER))continue;rules++;sels+=h.length;(byFile[rel]??=[]).push({h,mixed:r.sel.length!==h.length,anc:r.anc,body:r.body});}}
for(const [f,l] of Object.entries(byFile)){console.log(`## ${f} (${l.length})`);for(const x of l)console.log(`  ${tag(x.body)} ${x.mixed?"[MIXED] ":""}${x.anc.length?"["+x.anc.join(" > ")+"] ":""}${x.h.join(", ")}  { ${x.body} }`);}
console.log(`files=${Object.keys(byFile).length} rules=${rules} selectors=${sels}`);
