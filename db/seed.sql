-- Kernel seed corpus.
-- Sample employers are fictional and labeled as such everywhere they surface.
-- Real companies carry coverage metadata only: Kernel publishes nothing about a
-- real employer until verified relationships exist AND privacy thresholds pass.

DELETE FROM distribution_bands;
DELETE FROM financial_entries;
DELETE FROM moderation_stats;
DELETE FROM legal_requests;
DELETE FROM covenant_versions;
DELETE FROM testimony_topics;
DELETE FROM testimony;
DELETE FROM corroborations;
DELETE FROM metric_releases;
DELETE FROM question_trails;
DELETE FROM cohorts;
DELETE FROM events;
DELETE FROM metric_definitions;
DELETE FROM companies;

INSERT INTO companies (id, slug, name, kind, sector, hq, headcount_band, founded, sample_disclosure, coverage_note) VALUES
 ('co-northwind','northwind-labs','Northwind Labs','sample','Software','San Francisco, CA','1,001-5,000','2014',
  'Northwind Labs is a fictional employer. Every number, quote, and event on this page is clearly labeled demonstration data, written so the product can be examined before real verified contributions exist.',
  NULL),
 ('co-helios','helios-semiconductor','Helios Semiconductor','sample','Semiconductors','Austin, TX','10,001-50,000','1998',
  'Helios Semiconductor is a fictional employer. Every number, quote, and event on this page is clearly labeled demonstration data.',
  NULL),
 ('co-meridian','meridian-retail','Meridian Retail Group','sample','Retail','Columbus, OH','50,001+','1971',
  'Meridian Retail Group is a fictional employer. Every number, quote, and event on this page is clearly labeled demonstration data.',
  NULL),
 ('co-stripe','stripe','Stripe','real','Payments','South San Francisco, CA','5,001-10,000','2010',NULL,'No verified evidence published yet.'),
 ('co-openai','openai','OpenAI','real','Artificial intelligence','San Francisco, CA','1,001-5,000','2015',NULL,'No verified evidence published yet.'),
 ('co-anthropic','anthropic','Anthropic','real','Artificial intelligence','San Francisco, CA','1,001-5,000','2021',NULL,'No verified evidence published yet.'),
 ('co-google','google','Google','real','Internet','Mountain View, CA','100,001+','1998',NULL,'No verified evidence published yet.'),
 ('co-meta','meta','Meta','real','Internet','Menlo Park, CA','50,001-100,000','2004',NULL,'No verified evidence published yet.'),
 ('co-microsoft','microsoft','Microsoft','real','Software','Redmond, WA','100,001+','1975',NULL,'No verified evidence published yet.'),
 ('co-amazon','amazon','Amazon','real','Internet','Seattle, WA','100,001+','1994',NULL,'No verified evidence published yet.'),
 ('co-cloudflare','cloudflare','Cloudflare','real','Internet infrastructure','San Francisco, CA','1,001-5,000','2009',NULL,'No verified evidence published yet.'),
 ('co-nvidia','nvidia','Nvidia','real','Semiconductors','Santa Clara, CA','10,001-50,000','1993',NULL,'No verified evidence published yet.');

INSERT INTO cohorts (id, company_id, label, dimension, parent_id, headcount_band) VALUES
 ('ch-nw-all','co-northwind','All verified contributors','all',NULL,NULL),
 ('ch-nw-eng','co-northwind','Engineering','function',NULL,'500-1,000'),
 ('ch-nw-sales','co-northwind','Sales','function',NULL,'250-500'),
 ('ch-nw-senior','co-northwind','Senior individual contributor','seniority',NULL,'250-500'),
 ('ch-he-all','co-helios','All verified contributors','all',NULL,NULL),
 ('ch-he-hw','co-helios','Hardware engineering','function',NULL,'1,000-5,000'),
 ('ch-he-remote','co-helios','Remote','region',NULL,'500-1,000'),
 ('ch-he-onsite','co-helios','On-site','region',NULL,'1,000-5,000'),
 ('ch-mr-all','co-meridian','All verified contributors','all',NULL,NULL),
 ('ch-mr-stores','co-meridian','Store operations','function',NULL,'10,000+'),
 ('ch-mr-hourly','co-meridian','Hourly','employment_status',NULL,'10,000+'),
 ('ch-mr-salaried','co-meridian','Salaried','employment_status',NULL,'1,000-5,000');

INSERT INTO events (id, company_id, slug, label, kind, occurred_on, disclosure, source_url) VALUES
 ('ev-nw-comp-2023','co-northwind','2023-compensation-refresh','2023 compensation refresh','compensation','2023-01-15','Fictional demonstration event.',NULL),
 ('ev-nw-leadership-2024','co-northwind','2024-leadership-change','2024 leadership change','leadership','2024-09-02','Fictional demonstration event.',NULL),
 ('ev-nw-restructure-2025','co-northwind','2025-restructuring','2025 restructuring','layoff','2025-02-10','Fictional demonstration event.',NULL),
 ('ev-he-rto-2025','co-helios','2025-location-policy','2025 location policy change','policy','2025-06-01','Fictional demonstration event.',NULL),
 ('ev-mr-scheduling-2025','co-meridian','2025-scheduling-system','2025 scheduling system change','policy','2025-03-20','Fictional demonstration event.','NULL');

INSERT INTO metric_definitions (id, key, label, question, response_type, unit, direction, method_note, verification_method, exclusions, sort_order) VALUES
 ('m-return-intent','return_intent','Would work here again','I would work here again','percent_agree','percent','higher_is_better','Share of verified contributors who agreed or strongly agreed on a five point scale, asked once per release period.','Verified employer relationship. Response rate reported with each release.',NULL,10),
 ('m-manager-trust','manager_trust','Manager keeps commitments','My manager keeps the commitments they make','percent_agree','percent','higher_is_better','Five point agreement scale, direct manager only, one answer per contributor per period.','Verified employer relationship.',NULL,20),
 ('m-exec-trust','exec_trust','Trust in executive leadership','I trust executive leadership to act in the interest of the people who work here','percent_agree','percent','higher_is_better','Five point agreement scale.','Verified employer relationship.',NULL,30),
 ('m-promo-clarity','promotions_clarity','Promotion criteria are clear','Promotion criteria at this company are clear and applied consistently','percent_agree','percent','higher_is_better','Five point agreement scale.','Verified employer relationship.',NULL,40),
 ('m-promo-wait','promotion_wait_years','Promotion wait','How long did you wait between your last two promotions','number','years','lower_is_better','Median reported wait in years.','Verified employer relationship. Self reported timing.',NULL,50),
 ('m-bad-news','bad_news_upward','Bad news travels upward','Bad news can travel upward here without retaliation','percent_agree','percent','higher_is_better','Five point agreement scale.','Verified employer relationship.',NULL,60),
 ('m-review-fairness','perf_review_fairness','Reviews feel fair','Performance reviews at this company feel fair','percent_agree','percent','higher_is_better','Five point agreement scale.','Verified employer relationship.',NULL,70),
 ('m-layoffs','layoffs_handled','Layoffs handled respectfully','Layoffs here were handled respectfully','percent_agree','percent','higher_is_better','Five point agreement scale, asked only in periods with a documented reduction in force.','Verified employer relationship. Asked only of contributors present during the event.',NULL,80),
 ('m-comp-market','comp_vs_market','Compensation at or above market','My compensation is at or above market for my role and level','percent_agree','percent','higher_is_better','Five point agreement scale.','Verified employer relationship.',NULL,90),
 ('m-hours','workload_hours','Typical weekly hours','How many hours do you typically work in a week','distribution','hours','neutral','Median reported weekly hours with the reported distribution shown in full.','Verified employer relationship. Self reported.',NULL,100);

INSERT INTO metric_releases (id, company_id, metric_id, cohort_id, period, value, n, ci_low, ci_high, event_id, release_batch, published_at) VALUES
 ('r-001','co-northwind','m-return-intent','ch-nw-all','2022',81,612,3.1,NULL,NULL,'batch-2022-h1','2022-07-01'),
 ('r-002','co-northwind','m-return-intent','ch-nw-all','2023',72,655,3.4,NULL,'ev-nw-comp-2023','batch-2023-h1','2023-07-01'),
 ('r-003','co-northwind','m-return-intent','ch-nw-all','2024',54,701,3.6,NULL,'ev-nw-leadership-2024','batch-2024-h2','2024-11-01'),
 ('r-004','co-northwind','m-return-intent','ch-nw-all','2025',34,733,3.4,NULL,'ev-nw-restructure-2025','batch-2025-h2','2025-08-01'),
 ('r-005','co-northwind','m-return-intent','ch-nw-all','2026',21,415,4.1,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-006','co-northwind','m-manager-trust','ch-nw-all','2022',78,600,3.3,NULL,NULL,'batch-2022-h1','2022-07-01'),
 ('r-007','co-northwind','m-manager-trust','ch-nw-all','2023',74,640,3.4,NULL,NULL,'batch-2023-h1','2023-07-01'),
 ('r-008','co-northwind','m-manager-trust','ch-nw-all','2024',66,690,3.5,NULL,NULL,'batch-2024-h2','2024-11-01'),
 ('r-009','co-northwind','m-manager-trust','ch-nw-all','2025',51,720,3.6,NULL,NULL,'batch-2025-h2','2025-08-01'),
 ('r-010','co-northwind','m-manager-trust','ch-nw-all','2026',47,410,4.2,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-011','co-northwind','m-exec-trust','ch-nw-all','2022',71,600,3.6,NULL,NULL,'batch-2022-h1','2022-07-01'),
 ('r-012','co-northwind','m-exec-trust','ch-nw-all','2023',69,640,3.5,NULL,NULL,'batch-2023-h1','2023-07-01'),
 ('r-013','co-northwind','m-exec-trust','ch-nw-all','2024',52,690,3.7,NULL,'ev-nw-leadership-2024','batch-2024-h2','2024-11-01'),
 ('r-014','co-northwind','m-exec-trust','ch-nw-all','2025',33,720,3.4,NULL,NULL,'batch-2025-h2','2025-08-01'),
 ('r-015','co-northwind','m-exec-trust','ch-nw-all','2026',29,410,4.3,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-016','co-northwind','m-promo-clarity','ch-nw-all','2023',68,500,4.0,NULL,NULL,'batch-2023-h1','2023-07-01'),
 ('r-017','co-northwind','m-promo-clarity','ch-nw-all','2024',61,540,4.1,NULL,NULL,'batch-2024-h2','2024-11-01'),
 ('r-018','co-northwind','m-promo-clarity','ch-nw-all','2025',49,560,4.1,NULL,NULL,'batch-2025-h2','2025-08-01'),
 ('r-019','co-northwind','m-promo-clarity','ch-nw-all','2026',43,360,5.0,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-020','co-northwind','m-bad-news','ch-nw-all','2024',41,540,4.1,NULL,NULL,'batch-2024-h2','2024-11-01'),
 ('r-021','co-northwind','m-bad-news','ch-nw-all','2025',27,560,3.7,NULL,NULL,'batch-2025-h2','2025-08-01'),
 ('r-022','co-northwind','m-bad-news','ch-nw-all','2026',23,360,4.3,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-023','co-northwind','m-layoffs','ch-nw-all','2025',18,430,3.6,NULL,'ev-nw-restructure-2025','batch-2025-h2','2025-08-01'),
 ('r-024','co-northwind','m-layoffs','ch-nw-all','2026',22,300,4.6,NULL,'ev-nw-restructure-2025','batch-2026-h1','2026-05-01'),
 ('r-025','co-northwind','m-comp-market','ch-nw-all','2024',74,540,3.7,NULL,NULL,'batch-2024-h2','2024-11-01'),
 ('r-026','co-northwind','m-comp-market','ch-nw-all','2026',69,360,4.7,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-027','co-northwind','m-hours','ch-nw-all','2024',44.5,540,NULL,NULL,NULL,'batch-2024-h2','2024-11-01'),
 ('r-028','co-northwind','m-hours','ch-nw-all','2026',47,360,NULL,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-029','co-northwind','m-return-intent','ch-nw-eng','2026',24,120,7.6,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-030','co-northwind','m-return-intent','ch-nw-sales','2026',17,88,7.8,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-031','co-northwind','m-return-intent','ch-nw-senior','2026',26,64,10.5,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-032','co-helios','m-return-intent','ch-he-all','2022',79,1200,2.3,NULL,NULL,'batch-2022-h2','2022-10-01'),
 ('r-033','co-helios','m-return-intent','ch-he-all','2023',77,1250,2.3,NULL,NULL,'batch-2023-h2','2023-10-01'),
 ('r-034','co-helios','m-return-intent','ch-he-all','2024',74,1310,2.3,NULL,NULL,'batch-2024-h2','2024-10-01'),
 ('r-035','co-helios','m-return-intent','ch-he-all','2025',66,1380,2.4,NULL,'ev-he-rto-2025','batch-2025-h2','2025-10-01'),
 ('r-036','co-helios','m-return-intent','ch-he-all','2026',63,900,3.1,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-037','co-helios','m-manager-trust','ch-he-all','2024',72,1300,2.4,NULL,NULL,'batch-2024-h2','2024-10-01'),
 ('r-038','co-helios','m-manager-trust','ch-he-all','2026',69,900,3.0,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-039','co-helios','m-promo-wait','ch-he-all','2024',2.9,820,NULL,NULL,NULL,'batch-2024-h2','2024-10-01'),
 ('r-040','co-helios','m-promo-wait','ch-he-all','2026',3.4,640,NULL,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-041','co-helios','m-promo-clarity','ch-he-all','2026',57,900,3.2,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-042','co-helios','m-comp-market','ch-he-all','2026',76,900,2.8,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-043','co-helios','m-hours','ch-he-all','2026',45,900,NULL,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-044','co-helios','m-promo-clarity','ch-he-remote','2026',41,190,7.0,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-045','co-helios','m-promo-clarity','ch-he-onsite','2026',63,520,4.1,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-046','co-helios','m-return-intent','ch-he-remote','2026',52,190,7.2,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-047','co-helios','m-return-intent','ch-he-onsite','2026',66,520,4.1,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-048','co-meridian','m-return-intent','ch-mr-all','2023',61,2400,2.0,NULL,NULL,'batch-2023-h2','2023-10-01'),
 ('r-049','co-meridian','m-return-intent','ch-mr-all','2024',58,2500,1.9,NULL,NULL,'batch-2024-h2','2024-10-01'),
 ('r-050','co-meridian','m-return-intent','ch-mr-all','2025',52,2600,1.9,NULL,'ev-mr-scheduling-2025','batch-2025-h2','2025-10-01'),
 ('r-051','co-meridian','m-return-intent','ch-mr-all','2026',50,1750,2.3,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-052','co-meridian','m-manager-trust','ch-mr-all','2025',61,2600,1.9,NULL,NULL,'batch-2025-h2','2025-10-01'),
 ('r-053','co-meridian','m-manager-trust','ch-mr-all','2026',59,1750,2.3,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-054','co-meridian','m-comp-market','ch-mr-all','2026',44,1750,2.4,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-055','co-meridian','m-review-fairness','ch-mr-all','2026',47,1750,2.4,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-056','co-meridian','m-hours','ch-mr-all','2026',38,1750,NULL,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-057','co-meridian','m-return-intent','ch-mr-stores','2026',49,1200,2.8,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-058','co-meridian','m-comp-market','ch-mr-hourly','2026',39,980,3.1,NULL,NULL,'batch-2026-h1','2026-05-01'),
 ('r-059','co-meridian','m-comp-market','ch-mr-salaried','2026',61,540,4.1,NULL,NULL,'batch-2026-h1','2026-05-01');

INSERT INTO testimony (id, company_id, cohort_id, layer, body, period, event_id, verification_class, release_batch, published_at, withdrawn_at) VALUES
 ('t-001','co-northwind','ch-nw-eng','experience','Our team was told in January that there would be no reductions. In February, 19 of the 84 people in my org were let go in a single morning call. Severance was six weeks. My manager learned the same morning we did.','2025-Q1','ev-nw-restructure-2025','Verified employment relationship with Northwind Labs at the time described','batch-2025-h2','2025-08-14',NULL),
 ('t-002','co-northwind','ch-nw-eng','experience','The 2024 leadership change moved roadmap ownership from product teams to a central planning group. Teams kept shipping, but nobody could say who approved what.','2024-Q4','ev-nw-leadership-2024','Verified employment relationship with Northwind Labs at the time described','batch-2024-h2','2024-12-02',NULL),
 ('t-003','co-northwind','ch-nw-sales','claim','Management altered sales quotas retroactively after the quarter closed.','2025-Q4',NULL,'Verified employment relationship with Northwind Labs at the time described','batch-2026-h1','2026-02-19',NULL),
 ('t-004','co-northwind',NULL,'opinion','Leadership is disconnected from the actual work.','2026-Q1',NULL,'Verified employment relationship with Northwind Labs at the time described','batch-2026-h1','2026-03-04',NULL),
 ('t-005','co-northwind','ch-nw-eng','experience','On-call rotations went from six weeks to three weeks without adding engineers to the team.','2026-Q1',NULL,'Verified employment relationship with Northwind Labs at the time described','batch-2026-h1','2026-04-11',NULL),
 ('t-006','co-northwind','ch-nw-senior','claim','Promotion packets for senior engineers required a sponsor approval that was never described in the published criteria.','2025-Q3',NULL,'Verified employment relationship with Northwind Labs at the time described','batch-2025-h2','2025-11-27',NULL),
 ('t-007','co-helios','ch-he-remote','experience','Remote engineers on my team were asked to relocate or move to a contract role during the 2025 policy change. The published policy said remote work was still supported.','2025-Q3','ev-he-rto-2025','Verified employment relationship with Helios Semiconductor at the time described','batch-2025-h2','2025-11-08',NULL),
 ('t-008','co-helios','ch-he-remote','claim','Promotion committee decisions for remote staff were consistently deferred compared with on-site peers at the same level.','2026-Q1',NULL,'Verified employment relationship with Helios Semiconductor at the time described','batch-2026-h1','2026-03-22',NULL),
 ('t-009','co-helios','ch-he-hw','opinion','The hardware work is genuinely interesting and the pay is honest. The culture is cautious in a way that slows everything down.','2026-Q1',NULL,'Verified employment relationship with Helios Semiconductor at the time described','batch-2026-h1','2026-04-02',NULL),
 ('t-010','co-helios','ch-he-hw','experience','Buyout offers were presented to two thirds of my group in the same week the company said the group was growing.','2025-Q4','ev-he-rto-2025','Verified employment relationship with Helios Semiconductor at the time described','batch-2026-h1','2026-01-30',NULL),
 ('t-011','co-meridian','ch-mr-stores','experience','Scheduling is published 72 hours ahead at my store. Before the 2025 system change it was published 14 days ahead.','2025-Q2','ev-mr-scheduling-2025','Verified employment relationship with Meridian Retail Group at the time described','batch-2025-h2','2025-09-19',NULL),
 ('t-012','co-meridian','ch-mr-hourly','experience','Full-time hours were cut to 31 to 34 a week across my district while the store was posting record sales.','2026-Q1',NULL,'Verified employment relationship with Meridian Retail Group at the time described','batch-2026-h1','2026-03-15',NULL),
 ('t-013','co-meridian','ch-mr-stores','opinion','Most store managers are decent people working inside a system that does not give them room to help.','2026-Q1',NULL,'Verified employment relationship with Meridian Retail Group at the time described','batch-2026-h1','2026-04-20',NULL),
 ('t-014','co-meridian','ch-mr-hourly','claim','Break coverage at my store is recorded as unpaid even when the break is interrupted by customers.','2026-Q1',NULL,'Verified employment relationship with Meridian Retail Group at the time described','batch-2026-h1','2026-05-02',NULL);

INSERT INTO testimony_topics (testimony_id, topic, stance, salience, model, prompt_version, inferred_at) VALUES
 ('t-001','layoff communication','negative',0.94,'jev-1.13','kernel-topic-v1','2025-08-14'),
 ('t-001','severance','negative',0.71,'jev-1.13','kernel-topic-v1','2025-08-14'),
 ('t-002','reorg communication','negative',0.88,'jev-1.13','kernel-topic-v1','2024-12-02'),
 ('t-002','decision ownership','negative',0.62,'jev-1.13','kernel-topic-v1','2024-12-02'),
 ('t-003','quota changes','negative',0.91,'jev-1.13','kernel-topic-v1','2026-02-19'),
 ('t-004','executive leadership','negative',0.86,'jev-1.13','kernel-topic-v1','2026-03-04'),
 ('t-005','on-call load','negative',0.83,'jev-1.13','kernel-topic-v1','2026-04-11'),
 ('t-006','promotion criteria','negative',0.90,'jev-1.13','kernel-topic-v1','2025-11-27'),
 ('t-007','location policy','negative',0.92,'jev-1.13','kernel-topic-v1','2025-11-08'),
 ('t-007','remote work','negative',0.78,'jev-1.13','kernel-topic-v1','2025-11-08'),
 ('t-008','promotion fairness','negative',0.93,'jev-1.13','kernel-topic-v1','2026-03-22'),
 ('t-008','remote work','negative',0.74,'jev-1.13','kernel-topic-v1','2026-03-22'),
 ('t-009','technical work','positive',0.81,'jev-1.13','kernel-topic-v1','2026-04-02'),
 ('t-009','pace','mixed',0.66,'jev-1.13','kernel-topic-v1','2026-04-02'),
 ('t-010','buyouts','negative',0.89,'jev-1.13','kernel-topic-v1','2026-01-30'),
 ('t-011','scheduling notice','negative',0.87,'jev-1.13','kernel-topic-v1','2025-09-19'),
 ('t-012','hours','negative',0.90,'jev-1.13','kernel-topic-v1','2026-03-15'),
 ('t-012','sales performance','mixed',0.52,'jev-1.13','kernel-topic-v1','2026-03-15'),
 ('t-013','store management','positive',0.72,'jev-1.13','kernel-topic-v1','2026-04-20'),
 ('t-013','corporate policy','negative',0.80,'jev-1.13','kernel-topic-v1','2026-04-20'),
 ('t-014','breaks','negative',0.85,'jev-1.13','kernel-topic-v1','2026-05-02'),
 ('t-014','timekeeping','negative',0.77,'jev-1.13','kernel-topic-v1','2026-05-02');

INSERT INTO corroborations (id, company_id, cluster_key, summary, reporter_count, first_report, last_report) VALUES
 ('c-001','co-northwind','quota-changes','Retroactive quota changes after the quarter closed',11,'2025-10-04','2026-02-19'),
 ('c-002','co-northwind','oncall-rotation','On-call rotation reduced without adding engineers',7,'2026-01-12','2026-04-11'),
 ('c-003','co-helios','remote-promotion','Remote staff blocked from promotion compared with on-site peers',9,'2025-11-08','2026-05-14'),
 ('c-004','co-meridian','scheduling-notice','Scheduling notice shortened after the 2025 system change',14,'2025-04-02','2026-03-15');

INSERT INTO question_trails (id, company_id, canonical_question, intent_hint, ask_count, first_asked, last_asked, approved) VALUES
 ('q-001','co-northwind','What changed after the 2025 restructuring?','timeline',229,'2025-02-12','2026-09-18',1),
 ('q-002','co-northwind','Are promotions fair for senior engineers?','metric',187,'2023-08-01','2026-09-17',1),
 ('q-003','co-northwind','How does management compare with executive leadership?','compare',96,'2024-10-02','2026-09-12',1),
 ('q-004','co-helios','Are remote employees disadvantaged for promotion?','metric',163,'2025-07-01','2026-09-19',1),
 ('q-005','co-helios','What is the typical promotion wait?','metric',88,'2024-10-08','2026-09-10',1),
 ('q-006','co-meridian','Is the published schedule reliable?','metric',141,'2025-04-01','2026-09-16',1),
 ('q-007','co-meridian','How are hours distributed between hourly and salaried staff?','compare',73,'2026-01-05','2026-09-02',1);

INSERT INTO financial_entries (id, period, kind, category, amount_cents, currency, note) VALUES
 ('f-001','2026-09','cost','infrastructure',0,'USD','No operating spend recorded yet. Kernel runs on an existing Cloudflare account and a development plan for inference. This ledger opens with real numbers the month spending starts.'),
 ('f-002','2026-09','donation','donations',0,'USD','Donations are not being accepted yet. Donations will never buy product privileges, influence, or data access.'),
 ('f-003','2026-09','cost','moderation',0,'USD','Moderation is performed by the maintainer at no recorded cost.'),
 ('f-004','2026-09','cost','legal',0,'USD','No legal costs recorded.');

INSERT INTO moderation_stats (id, period, metric, value) VALUES
 ('ms-001','2026-09','submissions_received',0),
 ('ms-002','2026-09','published',0),
 ('ms-003','2026-09','held_for_privacy_review',0),
 ('ms-004','2026-09','held_for_human_review',0),
 ('ms-005','2026-09','rejected',0),
 ('ms-006','2026-09','redactions_requested',0),
 ('ms-007','2026-09','withdrawals',0);

INSERT INTO covenant_versions (id, version, effective_on, principles_json, change_note) VALUES
 ('cv-001','1.0.0','2026-09-21','["Access will remain free.","Employers receive no privileged access.","Employers cannot pay us.","We do not sell user data.","We do not sell behavioral data.","We minimize collection of identifying information.","Anonymous speech is protected to the maximum extent permitted by law.","Moderation rules apply identically to every organization.","Material policy changes require public notice and review.","The core platform and protocols remain open source."]','Initial Covenant, ratified at project start.');

INSERT INTO distribution_bands (release_id, band, share, sort_order) VALUES
 ('r-027','Under 40',14,0),('r-027','40 to 44',34,1),('r-027','45 to 49',31,2),('r-027','50 to 54',14,3),('r-027','55 or more',7,4),
 ('r-028','Under 40',9,0),('r-028','40 to 44',26,1),('r-028','45 to 49',33,2),('r-028','50 to 54',20,3),('r-028','55 or more',12,4),
 ('r-043','Under 40',16,0),('r-043','40 to 44',37,1),('r-043','45 to 49',28,2),('r-043','50 to 54',13,3),('r-043','55 or more',6,4),
 ('r-056','Under 30',27,0),('r-056','30 to 34',31,1),('r-056','35 to 39',24,2),('r-056','40 to 44',12,3),('r-056','45 or more',6,4);
