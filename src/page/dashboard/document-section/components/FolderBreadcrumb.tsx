import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { parseFolderKey } from '@/contexts/DocumentsContext'

export function FolderBreadcrumb({ folderKey }: { folderKey: string }) {
  const parsed = parseFolderKey(folderKey)
  const dirId = parsed.direction_id
  const parts = (parsed.name || '').split('::').filter(Boolean)
  if (!dirId || parts.length === 0) return null

  const toKey = (idxInclusive: number) =>
    `${dirId}::${parts.slice(0, idxInclusive + 1).join('::')}`

  const MAX_VISIBLE = 4
  const showEllipsis = parts.length > MAX_VISIBLE
  const hidden = showEllipsis ? parts.slice(1, parts.length - 2) : []
  const tail = showEllipsis ? parts.slice(parts.length - 2) : parts.slice(1)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/dashboard/documents">Documents</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />

        <BreadcrumbItem>
          {parts.length === 1 ? (
            <BreadcrumbPage>{parts[0]}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link to={`/dashboard/documents/${encodeURIComponent(toKey(0))}`}>
                {parts[0]}
              </Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {showEllipsis && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost">
                    <BreadcrumbEllipsis />
                    <span className="sr-only">Afficher les niveaux</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    {hidden.map((label, i) => {
                      const idx = i + 1
                      return (
                        <DropdownMenuItem key={`${dirId}__crumb__${idx}`} asChild>
                          <Link
                            to={`/dashboard/documents/${encodeURIComponent(toKey(idx))}`}
                          >
                            {label}
                          </Link>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </>
        )}

        {tail.map((label, i) => {
          const idx = showEllipsis ? parts.length - 2 + i : i + 1
          const isLast = idx === parts.length - 1
          return (
            <Fragment key={`${dirId}__crumb_tail__${idx}`}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      to={`/dashboard/documents/${encodeURIComponent(toKey(idx))}`}
                    >
                      {label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

