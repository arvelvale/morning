import type { LayoutIssue, LayoutReport } from './types';

/** One entry per issue; legacy UI reads the same record through fixes/warnings. */
export function addIssue(report: LayoutReport, issue: LayoutIssue, message: string) {
  const list = report.issues ??= [];
  if (list.some(i => i.code === issue.code && i.objectIds.join('|') === issue.objectIds.join('|') && i.status === issue.status)) return;
  list.push(issue);
  (issue.status === 'repaired' ? report.fixes : report.warnings).push(message);
}
