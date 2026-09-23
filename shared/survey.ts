import {z} from 'zod';
export const survey = [
 {key:'compensation',label:'Compensation compared with the market',options:['Below market','Market','Above market','Exceptional']},
 {key:'workload',label:'Typical weekly workload',options:['Under 40','40–49','50–59','60 or more']},
 {key:'manager_trust',label:'My manager keeps commitments',options:['Agree','Neutral','Disagree']},
 {key:'perf_review_fairness',label:'Performance reviews feel fair',options:['Agree','Neutral','Disagree']},
 {key:'bad_news_upward',label:'Bad news can travel upward without retaliation',options:['Agree','Neutral','Disagree']},
 {key:'layoffs_handled',label:'Layoffs were handled respectfully',options:['Agree','Neutral','Disagree']},
 {key:'promotions_clarity',label:'Promotion criteria are clear',options:['Agree','Neutral','Disagree']},
 {key:'manager_return',label:'I would work for my manager again',options:['Agree','Neutral','Disagree']},
 {key:'return_intent',label:'I would work here again',options:['Agree','Neutral','Disagree']},
 {key:'exec_trust',label:'I trust executive leadership',options:['Agree','Neutral','Disagree']},
] as const;
export function validateSurvey(value:unknown):Record<string,string> {
 const obj=z.record(z.string(),z.string().max(40)).parse(value??{});
 for(const [key,answer] of Object.entries(obj)) {
  const item=survey.find(q=>q.key===key);
  if(!item || !(item.options as readonly string[]).includes(answer)) throw new Error('invalid_survey_answer');
 }
 return obj;
}
export interface SurveyAggregate {key:string;label:string;n:number;value:number|null;distribution:{band:string;share:number}[];agreement:boolean;responseType:'percent_agree'|'distribution';}
/** Category questions have no scalar: value is null and only the band shares are meaningful. */
export function aggregateAnswers(responses:Record<string,string>[], minimum:number):SurveyAggregate[] {
 return survey.flatMap(question=>{
  const answers=responses.map(r=>r[question.key]).filter((v):v is string=>Boolean(v));
  if(answers.length<minimum) return [];
  const counts=question.options.map(option=>({option,count:answers.filter(a=>a===option).length}));
  const agreement=question.options[0]==='Agree';
  return [{key:question.key,label:question.label,n:answers.length,value:agreement?counts[0]!.count/answers.length*100:null,distribution:counts.map(c=>({band:c.option,share:c.count/answers.length*100})),agreement,responseType:agreement?'percent_agree' as const:'distribution' as const}];
 });
}
