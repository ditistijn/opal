import { cn } from "@/lib/utils"
export const Table = ({ className, ...p }) => <div className="relative w-full overflow-auto"><table className={cn("w-full caption-bottom text-sm", className)} {...p} /></div>
export const TableHeader = ({ className, ...p }) => <thead className={cn("[&_tr]:border-b", className)} {...p} />
export const TableBody = ({ className, ...p }) => <tbody className={cn("[&_tr:last-child]:border-0", className)} {...p} />
export const TableFooter = ({ className, ...p }) => <tfoot className={cn("border-t bg-neutral-50 font-medium", className)} {...p} />
export const TableRow = ({ className, ...p }) => <tr className={cn("border-b border-neutral-200 transition-colors hover:bg-neutral-50", className)} {...p} />
export const TableHead = ({ className, ...p }) => <th className={cn("h-12 px-4 text-left align-middle font-medium text-neutral-500", className)} {...p} />
export const TableCell = ({ className, ...p }) => <td className={cn("p-4 align-middle", className)} {...p} />
export const TableCaption = ({ className, ...p }) => <caption className={cn("mt-4 text-sm text-neutral-500", className)} {...p} />
export default Table
