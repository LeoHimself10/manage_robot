export const PREFIX='/workbench/quality-pilot';
export function rewriteProductionLinks(value) {
  return value
    .replaceAll('http://127.0.0.1:8808', PREFIX)
    .replaceAll('http://127.0.0.1:8809', PREFIX+'/tong')
    .replaceAll('http://127.0.0.1:8797', PREFIX)
    .replace(/(["'`=])(\/(?:api|static|workbench(?!\/quality-pilot))(?:\/|[?"'`]))/g, (all,quote,path)=>quote+PREFIX+path);
}
