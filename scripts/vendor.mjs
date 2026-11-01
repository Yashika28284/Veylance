import { copyFileSync,mkdirSync } from 'node:fs';
mkdirSync('dist/assets/vendor',{recursive:true});mkdirSync('dist/assets/fonts',{recursive:true});mkdirSync('dist/assets/licenses',{recursive:true});
copyFileSync('node_modules/chart.js/dist/chart.umd.js','dist/assets/vendor/chart.umd.js');
copyFileSync('node_modules/chart.js/LICENSE.md','dist/assets/licenses/Chart.js-LICENSE.md');
for(const name of ['dm-sans','fraunces']){
 for(const weight of name==='dm-sans'?[400,500,600,700]:[400,500])copyFileSync(`node_modules/@fontsource/${name}/files/${name}-latin-${weight}-normal.woff2`,`dist/assets/fonts/${name}-latin-${weight}-normal.woff2`);
 copyFileSync(`node_modules/@fontsource/${name}/LICENSE`,`dist/assets/licenses/${name}-OFL.txt`);
}
