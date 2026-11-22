import {feedback, field} from '../components/common/fields.js';
import {empty, panel} from '../components/common/panels.js';
import {table} from '../components/common/table.js';
import {handler} from '../hooks/action.js';
import {session} from '../stores/session.js';
import {workspace} from '../stores/workspace.js';
import {button, el, link, p} from '../utils/dom.js';
import {date} from '../utils/format.js';

export async function inputs(route, refresh) {
  const {spec,datasets} = workspace;
  const selected = datasets.find(item => item.id === route.id) || datasets[0];
  const error = feedback();
  const sample = button('下载示例 CSV', {class:'quiet',onClick:event=>handler(sample,error,()=>workspace.download('/template',spec.sample_name))(event)});
  const detail = selected && await workspace.getDataset(selected.id,route.offset);
  const columns = detail?.schema_version === 'v2' && spec.shift_field
    ? [...spec.fields.slice(0,2), spec.shift_field, ...spec.fields.slice(2)].map(field => ({key:field.key,label:field.label}))
    : spec.fields.map(field => ({key:field.key,label:field.label}));
  const quarantined = detail?.quarantine || [];
  const preview = detail ? panel('批次明细', el('div',{class:'actions'},
    el('label',{for:'dataset-id',class:'sr'}, '选择数据批次'),
    el('select',{id:'dataset-id','aria-label':'选择数据批次',onChange:event=>{location.hash=`#inputs/${event.target.value}`;}},
      datasets.map(item=>el('option',{value:item.id,selected:item.id === selected.id}, item.name))),
    link('使用此批次运行',`#run/${detail.id}`,{class:'quiet'})),
    p(`${detail.filename} · ${detail.row_count} 行 · ${date(detail.created_at)}`,'filename'),
    p(`结构版本：${detail.schema_label} · 隔离记录 ${detail.quarantine_count} 条`,'subtle'),
    table(columns,detail.rows,{caption:'批次明细',pageSize:16}),
    el('div',{class:'pagination'},
      route.offset > 0 && link('上一批明细',`#inputs/${detail.id}/${Math.max(0,route.offset-16)}`,{class:'quiet'}),
      p(`${detail.rows.length ? route.offset+1 : route.offset}–${route.offset+detail.rows.length} / ${detail.row_count}`),
      route.offset+16 < detail.row_count && link('下一批明细',`#inputs/${detail.id}/${route.offset+16}`,{class:'quiet'})))
    : empty('没有可用的批次。请导入示例或业务 CSV。');
  const quarantinePanel = quarantined.length ? panel('隔离记录',
    p('以下记录不参与汇总，随批次完整保留并注明原因。','subtle'),
    table([
      {key:'line',label:'CSV 行号'},
      {label:'市场',render:item=>item.record.market_id},
      {label:'观测日期',render:item=>item.record.date},
      {label:'班次',render:item=>item.record.shift || '（空）'},
      {key:'reason',label:'隔离原因'},
    ],quarantined,{caption:'隔离记录',pageSize:8})) : null;
  const submit = button('校验并导入', {type:'submit',class:'primary'});
  const upload = session.canWrite && el('form',{class:'fields',onSubmit:handler(submit,error,async event=>{
    const data = new FormData(event.target);
    const file = data.get('source');
    if (!file?.size) throw new Error('请选择一个 CSV 文件');
    if (file.size > 2_000_000) throw new Error('CSV 最多 2 MB');
    const item = await workspace.upload({name:data.get('batch_name'),filename:file.name,csv_text:await file.text()});
    const target = `#inputs/${item.id}`;
    if (location.hash === target) await refresh();
    else location.hash = target;
  })},field({key:'batch_name',label:'批次名称',type:'string',max_length:120}),
    el('label',{class:'field',for:'source'}, el('span',{},'业务 CSV'),el('input',{id:'source',type:'file',name:'source',accept:'.csv,text/csv',required:true})), submit);
  return el('div',{class:'two-col'},el('div',{class:'wide-panel'},preview,quarantinePanel),el('aside',{class:'sidebar-panel'},
    panel('数据导入',p('导入后保留原批次和校验指纹，可用同一份数据复跑。','subtle'),sample,upload,error),
    panel('字段说明',el('dl',{class:'dictionary'},[...spec.fields.map(item=>el('div',{},el('dt',{},item.label),
      el('dd',{},item.key,item.required === false ? ' · 可空' : ' · 必填',item.options ? ` · ${item.options.join(' / ')}` : ''))),
      spec.shift_field && el('div',{},el('dt',{},spec.shift_field.label),
        el('dd',{},spec.shift_field.key,' · 新版必填',spec.shift_field.options ? ` · ${spec.shift_field.options.join(' / ')}` : ''))]),
      spec.shift_field && p('旧版 CSV 无班次列，按市场日口径导入；新版 CSV 增加班次列，按班次口径导入。新版中班次缺失或同一市场日班次重复的记录会被隔离并注明原因，不参与汇总。','subtle'))));
}
