export function createNotebookFixture(){
  const stamp='2026-01-01T00:00:00.000Z';
  const topics=[{id:'topic_a',title:'测试主题 A',createdAt:stamp},{id:'topic_b',title:'测试主题 B',createdAt:stamp}];
  const notes=['a','b','c'].map((key,i)=>({id:`note_${key}`,topicId:i<2?'topic_a':'topic_b',title:`测试笔记 ${key}`,content:'测试用正文',type:'concept',status:'learning',tags:['test'],sources:[{id:`source_${key}`,type:'thought',title:'测试来源',excerpt:'测试摘录'}],createdAt:stamp,updatedAt:stamp}));
  return {version:1,revision:0,topics,notes,links:[{id:'link_ab',topicId:'topic_a',from:'note_a',to:'note_b',type:'extends',label:'测试关系'}]};
}
