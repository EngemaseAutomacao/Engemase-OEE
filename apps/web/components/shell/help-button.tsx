import Link from "next/link"
import { CircleHelpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Atalho para a central de ajuda no cabeçalho. */
export function HelpButton({ href }: { href: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" aria-label="Central de ajuda">
          <Link href={href}>
            <CircleHelpIcon className="size-4" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Central de ajuda</TooltipContent>
    </Tooltip>
  )
}
