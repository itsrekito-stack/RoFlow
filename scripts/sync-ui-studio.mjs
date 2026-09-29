import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const source=resolve(here,"../ui-studio");
const target=resolve(here,"../web/ui-studio");

await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});

for(const file of ["app.css","engine-v2.js","app.js"]){
 await copyFile(resolve(source,file),resolve(target,file));
}

let html=await readFile(resolve(source,"index.html"),"utf8");
const appScript=/<script src="\.\/app\.js(?:\?[^"]*)?"><\/script>/;
if(!appScript.test(html))throw new Error("UI Studio app.js tag not found");
html=html.replace(
 appScript,
 match=>'<script>window.__ROFLOW_EMBEDDED__=true;</script>\n'+match
);
await writeFile(resolve(target,"index.html"),html,"utf8");

console.log("RoFlow: bundled UI Studio synced");
