export const KANBAN_COLUMNS = [
  { id: 'SCRIPT_DRAFT', title: '📝 Script Draft', dot: 'bg-slate-400', phase: 'pre' },
  { id: 'TODO', title: '🎯 To Do', dot: 'bg-blue-500', phase: 'production' },
  { id: 'IN_PROGRESS', title: '⚙️ In Progress', dot: 'bg-amber-500', phase: 'production' },
  { id: 'REVIEW', title: '✅ Review', dot: 'bg-purple-500', phase: 'post' },
  { id: 'APPROVED', title: '🎉 Approved', dot: 'bg-emerald-500', phase: 'post' },
  { id: 'PUBLISHED', title: '📦 Published', dot: 'bg-green-600', phase: 'archive' },
  { id: 'ARCHIVED', title: '📁 Archived', dot: 'bg-slate-500', phase: 'archive' },
]

export const PHASES = [
  { id: 'pre', title: '📝 Pre-Production' },
  { id: 'production', title: '🎬 Production' },
  { id: 'post', title: '✨ Post-Production' },
  { id: 'archive', title: '📦 Archive' },
]

export const FORMATS = ['UGC', 'VSL', 'TESTIMONIAL', 'POV', 'AUTHORITY', 'PROBLEM_SOLUTION']
export const FORMATS_EXTENDED = [...FORMATS, 'GREEN_SCREEN', 'COMPARISON', 'BEFORE_AFTER']
