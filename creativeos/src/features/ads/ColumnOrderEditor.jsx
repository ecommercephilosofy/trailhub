import { useState } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { Columns3, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

export default function ColumnOrderEditor({ columns, order, onChange }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(order)

  const openDialog = () => { setDraft(order); setOpen(true) }
  const items = draft.map((key) => columns.find((c) => c.key === key)).filter(Boolean)

  const onDragEnd = ({ source, destination }) => {
    if (!destination) return
    const next = [...draft]
    const [moved] = next.splice(source.index, 1)
    next.splice(destination.index, 0, moved)
    setDraft(next)
  }

  return (
    <>
      <Button variant="outline" size="icon" onClick={openDialog} title="Reordenar columnas"><Columns3 /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Orden de columnas</DialogTitle>
            <DialogDescription>Arrastra para reordenar</DialogDescription>
          </DialogHeader>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="cols">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1.5">
                  {items.map((col, i) => (
                    <Draggable key={col.key} draggableId={col.key} index={i}>
                      {(p, snapshot) => (
                        <div
                          ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps}
                          className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ${snapshot.isDragging ? 'shadow-lg ring-2 ring-indigo-300' : ''}`}
                        >
                          <GripVertical className="h-4 w-4 text-slate-300" /> {col.label}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
          <DialogFooter>
            <Button onClick={() => { onChange(draft); setOpen(false) }}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
