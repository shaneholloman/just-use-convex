import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"

import { collapseVariants } from "@/lib/motion"
import { cn } from "@/lib/utils"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

function CollapsibleContent({
  className,
  children,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      keepMounted
      render={(renderProps, state) => (
        <AnimatePresence initial={false}>
          {state.open && (
            <motion.div
              {...(renderProps as React.ComponentProps<typeof motion.div>)}
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              variants={collapseVariants}
              className={cn("overflow-hidden", className)}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
