import {describe,it,expect} from 'vitest';
import {validateDeliverableOutcome} from '../../src/quality/analysis/validate-quality-analysis';
const check=(acceptanceCriteria:string,name='原因分析结论与证据')=>validateDeliverableOutcome({name,description:'依据本次检测记录进行调查',acceptanceCriteria});
describe('deliverable outcomes',()=>{
 it('rejects screenshot predetermined cause and approval requirement',()=>{
  const issues=check('明确归因为临床因素，附上导管检测合格证明（如有），并经质量经理审核批准。','事件结案报告');
  expect(issues).toHaveLength(3);
 });
 it('rejects paper-only completion and independent closure gates',()=>{
  expect(check('提交分析报告')).not.toEqual([]);
  expect(check('质量终验通过并关闭质量事件')).not.toEqual([]);
 });
 it('permits reports supported by concrete evidence and unresolved causes',()=>{
  expect(check('检测记录包含样本标识、检测条件和照片，说明异常判定依据。','回收导管检测报告')).toEqual([]);
  expect(check('依据本次证据判断是否属于临床因素；未查明时记录已排除因素、剩余假设和后续调查。')).toEqual([]);
  expect(check('无需质量经理审核批准；提交检测记录及照片，标明判定依据。')).toEqual([]);
 });
});
