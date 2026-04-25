"use client";

import { useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { Loader2, FileText, FolderOpen, ClipboardCheck, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { ApplicantData } from "@/lib/excel-utils";
import { StatusBadge } from "./status-badge";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";

interface ApplicantTableProps {
  applicants: ApplicantData[];
  isLoading: boolean;
  lang: Language;
  searchQuery: string;
  statusFilter: string;
  selectedApplicantId: string | null;
  onSearchChange: (q: string) => void;
  onStatusFilterChange: (f: string) => void;
  onSelectApplicant: (a: ApplicantData) => void;
  onFolderUploadClick: () => void;
}

export function ApplicantTable({
  applicants, isLoading, lang, searchQuery, statusFilter,
  selectedApplicantId, onSearchChange, onStatusFilterChange,
  onSelectApplicant, onFolderUploadClick,
}: ApplicantTableProps) {
  const t = translations[lang];
  const [sorting, setSorting] = useState<SortingState>([]);

  const filteredData = useMemo(() => {
    return applicants.filter(app => {
      const matchesSearch =
        app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (app.taskNumber && app.taskNumber.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesStatus =
        statusFilter === 'all' ||
        (app.finalStatus || 'Pending').toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [applicants, searchQuery, statusFilter]);

  const columns = useMemo<ColumnDef<ApplicantData>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => column.toggleSorting()}>
          {t.table.name}
          <ArrowUpDown className="h-3 w-3" />
        </button>
      ),
      cell: ({ row }) => {
        const app = row.original;
        return (
          <div className="space-y-0.5">
            <div className="font-black text-sm flex items-center gap-2">
              {app.name}
              {app.isYouth && <span className="px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 text-[9px]">{t.table.youth}</span>}
              {app.confirmedAt && <span className="px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-500 text-[9px]"><ClipboardCheck className="h-2.5 w-2.5 inline" /></span>}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">{app.taskNumber}</div>
          </div>
        );
      },
    },
    {
      accessorKey: 'enterpriseName',
      header: ({ column }) => (
        <button className="flex items-center gap-1 hover:text-foreground transition-colors hidden md:flex" onClick={() => column.toggleSorting()}>
          {t.table.enterprise}
          <ArrowUpDown className="h-3 w-3" />
        </button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[120px] block hidden md:block">
          {row.original.enterpriseName || '-'}
        </span>
      ),
    },
    {
      accessorKey: 'llmStatus',
      header: ({ column }) => (
        <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => column.toggleSorting()}>
          {t.table.llmStatus}
          <ArrowUpDown className="h-3 w-3" />
        </button>
      ),
      cell: ({ row }) => <StatusBadge status={row.original.llmStatus} />,
    },
    {
      accessorKey: 'finalStatus',
      header: ({ column }) => (
        <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => column.toggleSorting()}>
          {t.table.finalStatus}
          <ArrowUpDown className="h-3 w-3" />
        </button>
      ),
      cell: ({ row }) => <StatusBadge status={row.original.finalStatus} />,
    },
  ], [lang, t]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  return (
    <>
      {/* Search + filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <FileText className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={lang === 'ko' ? "이름 또는 과제번호 검색..." : "Search name or task ID..."}
            className="w-full pl-10 pr-4 py-2 rounded-xl border bg-background/50 focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-bold"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
        <select
          className="px-3 py-2 rounded-xl border bg-background/50 text-sm font-bold outline-none cursor-pointer"
          value={statusFilter}
          onChange={e => onStatusFilterChange(e.target.value)}
        >
          <option value="all">{t.filter.all}</option>
          <option value="approved">{t.filter.approved}</option>
          <option value="rejected">{t.filter.rejected}</option>
          <option value="pending">{t.filter.pending}</option>
        </select>
        <span className="text-[10px] font-bold text-muted-foreground uppercase bg-accent px-2.5 py-1.5 rounded-lg">
          {filteredData.length} records
        </span>
        {(searchQuery || statusFilter !== 'all') && (
          <button
            onClick={() => { onSearchChange(""); onStatusFilterChange("all"); }}
            className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            {lang === 'ko' ? '초기화' : 'Clear'}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 rounded-2xl border bg-card/30 overflow-hidden flex flex-col min-h-[400px]">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-24 text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-bold text-sm">{lang === 'ko' ? "데이터 로드 중..." : "Loading..."}</p>
            </div>
          </div>
        ) : filteredData.length > 0 ? (
          <>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-card border-b">
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {headerGroup.headers.map(header => (
                        <th key={header.id} className="px-4 py-3">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-muted/10">
                  {table.getRowModel().rows.map(row => (
                    <tr
                      key={row.id}
                      onClick={() => onSelectApplicant(row.original)}
                      className={`group hover:bg-primary/5 transition-all cursor-pointer ${selectedApplicantId === row.original.id ? 'bg-primary/5' : ''}`}
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-4 py-3">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {table.getPageCount() > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t bg-card/50 text-xs text-muted-foreground">
                <span>
                  {lang === 'ko'
                    ? `${table.getState().pagination.pageIndex + 1} / ${table.getPageCount()} 페이지`
                    : `Page ${table.getState().pagination.pageIndex + 1} of ${table.getPageCount()}`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div
            className="flex-1 flex flex-col items-center justify-center py-24 text-muted-foreground cursor-pointer hover:bg-primary/3 transition-all"
            onClick={onFolderUploadClick}
          >
            <div className="p-6 rounded-3xl bg-primary/5 border-2 border-dashed border-primary/20 mb-6">
              <FolderOpen className="h-16 w-16 text-primary/30" />
            </div>
            <p className="text-xl font-black text-foreground/70 mb-2">
              {lang === 'ko' ? 'dataset 폴더를 선택하세요' : 'Select dataset folder'}
            </p>
            <p className="text-sm text-muted-foreground/70 text-center max-w-xs">
              {lang === 'ko'
                ? 'PDF 서류가 포함된 폴더를 업로드하면 AI가 자동 심사합니다'
                : 'Upload a folder with PDF documents for automatic AI screening'}
            </p>
            <div className="mt-6 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-black shadow-lg shadow-primary/20">
              {t.folderUploadBtn}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
