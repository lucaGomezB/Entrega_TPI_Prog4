/**
 * CategoriasCRUD — Category management admin page.
 *
 * Features:
 *   - Hierarchical tree table with expand/collapse (+/-) for parent categories.
 *   - CRUD operations: create, edit, delete categories via mutations.
 *   - Parent category selection via a tree-based modal (prevents cycles).
 *   - Text filter (client-side, preserves ancestor nodes so context is not lost).
 *   - Excel export of the flattened (depth-annotated) tree.
 */
import { useEffect, useState, useRef, type ReactNode } from "react";
import { AxiosError } from "axios";
import type { CategoriaCreate, CategoriaTree } from "@/features/categorias/api/categorias";
import { useCategoriasTree, useCreateCategoria, useUpdateCategoria, useDeleteCategoria } from "@/features/categorias/hooks/useCategorias";
import { uploadsApi } from "@/shared/api/uploads";
import ImageCarousel from "@/shared/components/ImageCarousel";
import { exportToExcel } from "@/shared/utils/exportExcel";
import { useAppForm, required } from "@/shared/hooks/useAppForm";
import { addToast } from "@/shared/components/Toast";

/* ── Helpers ── */

function flattenTree(nodes: CategoriaTree[], depth = 0): (CategoriaTree & { depth: number })[] {
  const result: (CategoriaTree & { depth: number })[] = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    if (node.subcategorias.length > 0) {
      result.push(...flattenTree(node.subcategorias, depth + 1));
    }
  }
  return result;
}

function getDescendantIds(node: CategoriaTree): number[] {
  const ids: number[] = [node.id];
  for (const child of node.subcategorias) {
    ids.push(...getDescendantIds(child));
  }
  return ids;
}

function findCategoriaInTree(nodes: CategoriaTree[], id: number): CategoriaTree | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.subcategorias.length > 0) {
      const found = findCategoriaInTree(node.subcategorias, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Filters the tree recursively. When a descendant matches the query,
 * ALL its ancestors are preserved so the user sees the full hierarchical path.
 * A node matches when its `nombre` contains the query (case-insensitive).
 */
function filterTree(nodes: CategoriaTree[], query: string): CategoriaTree[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();

  function matches(node: CategoriaTree): boolean {
    return node.nombre.toLowerCase().includes(q);
  }

  function filterRecursive(list: CategoriaTree[]): CategoriaTree[] {
    const result: CategoriaTree[] = [];
    for (const node of list) {
      const filteredChildren = filterRecursive(node.subcategorias);
      const selfMatches = matches(node);
      const childrenMatch = filteredChildren.length > 0;
      if (selfMatches || childrenMatch) {
        result.push({ ...node, subcategorias: selfMatches ? node.subcategorias : filteredChildren });
      }
    }
    return result;
  }

  return filterRecursive(nodes);
}

/* ── Selector de Categoria Padre (jerarquico) ── */

function ParentSelector({ treeData, currentId, onSelect, onClose }: {
  treeData: CategoriaTree[]; currentId: number | null; onSelect: (id: number | null, name: string) => void; onClose: () => void;
}) {
  const excludeIds = new Set<number>();
  if (currentId !== null) {
    const self = findCategoriaInTree(treeData, currentId);
    if (self) {
      for (const id of getDescendantIds(self)) excludeIds.add(id);
    }
  }

  const renderTreeOptions = (nodes: CategoriaTree[], depth = 0): ReactNode[] => {
    const elements: ReactNode[] = [];
    for (const node of nodes) {
      if (excludeIds.has(node.id)) continue;
      elements.push(
        <tr key={node.id} className="hover:bg-gray-100">
          <td className="p-2" style={{ paddingLeft: `${12 + depth * 20}px` }}>
            <span className="font-semibold text-gray-900">{node.nombre}</span>
          </td>
          <td className="p-2 text-sm text-gray-600">{node.descripcion ?? "-"}</td>
          <td className="p-2">
            <button onClick={() => onSelect(node.id, node.nombre)}
              className="bg-blue-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-blue-700">Seleccionar</button>
          </td>
        </tr>
      );
      if (node.subcategorias.length > 0) {
        elements.push(...renderTreeOptions(node.subcategorias, depth + 1));
      }
    }
    return elements;
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded p-6 w-full max-w-md max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Seleccionar Categoria superior</h2>
          <button onClick={onClose} className="text-gray-500 text-xl cursor-pointer">X</button>
        </div>
        <button onClick={() => onSelect(null, "")}
          className="mb-4 bg-gray-600 text-white px-4 py-1 rounded cursor-pointer hover:bg-gray-700">Ninguna (raiz)</button>
        <table className="w-full border-collapse border">
          <thead><tr className="bg-gray-200">
            <th className="border p-2 text-left">Nombre</th>
            <th className="border p-2 text-left">Descripcion</th>
            <th className="border p-2 text-left">Accion</th>
          </tr></thead>
          <tbody>{renderTreeOptions(treeData)}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ── CategoryTreeRow (recursive) ── */

function CategoryTreeRow({ categoria, depth, expanded, onToggle, onEdit, onDelete }: {
  categoria: CategoriaTree;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onEdit: (categoria: { id: number; nombre: string; descripcion: string | null; parent_id: number | null; orden_display: number }) => void;
  onDelete: (id: number) => void;
}) {
  const hasChildren = categoria.subcategorias.length > 0;
  const isExpanded = expanded.has(categoria.id);

  const rows: ReactNode[] = [];

  // Current node row
  rows.push(
    <tr key={categoria.id} className="hover:bg-blue-50 transition-colors border-b border-gray-100">
      {/* Name column with indentation + toggle */}
      <td className="px-3 py-2.5" style={{ paddingLeft: `${12 + depth * 20}px` }}>
        <div className="flex items-center gap-1.5">
          {/* Toggle button or spacer */}
          {hasChildren ? (
            <button
              onClick={() => onToggle(categoria.id)}
              className="min-w-[24px] min-h-[24px] w-6 h-6 flex items-center justify-center rounded text-sm font-bold border border-gray-300 bg-white hover:bg-gray-100 cursor-pointer transition-colors select-none leading-none"
              aria-label={isExpanded ? "Colapsar" : "Expandir"}
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : (
            <span className="inline-block w-6" />
          )}
          <span className="font-semibold text-gray-900">{categoria.nombre}</span>
          {hasChildren && (
            <span className="text-xs text-gray-400 ml-1">({categoria.subcategorias.length})</span>
          )}
        </div>
      </td>
      {/* Description column */}
      <td className="px-3 py-2.5 text-sm text-gray-600 hidden md:table-cell">
        {categoria.descripcion ?? "-"}
      </td>
      {/* Actions column */}
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          <button
            onClick={() => onEdit({ id: categoria.id, nombre: categoria.nombre, descripcion: categoria.descripcion, parent_id: categoria.parent_id, orden_display: categoria.orden_display })}
            className="bg-yellow-500 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-yellow-600"
          >
            Editar
          </button>
          <button
            onClick={() => onDelete(categoria.id)}
            className="bg-red-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-red-700"
          >
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );

  // Recursive children
  if (hasChildren && isExpanded) {
    for (const child of categoria.subcategorias) {
      rows.push(
        <CategoryTreeRow
          key={child.id}
          categoria={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    }
  }

  return <>{rows}</>;
}

/* ── Main Page ── */

export default function CategoriasCRUD() {
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedParentName, setSelectedParentName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Cloudinary Upload Widget state
  const cloudinaryWidgetRef = useRef<unknown>(null);
  const [imagenPublicIds, setImagenPublicIds] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  // ── TanStack Query ──
  const { data: treeData = [], isLoading, isError, error } = useCategoriasTree();

  const createMutation = useCreateCategoria();
  const updateMutation = useUpdateCategoria();
  const deleteMutation = useDeleteCategoria();

  // ── Tree state ──
  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredTree = filterTree(treeData, filter);

  const form = useAppForm<CategoriaCreate>({
    defaultValues: { nombre: "", descripcion: "", parent_id: null, orden_display: 0, imagen_url: [] },
    onSubmit: async ({ value }) => {
      setSubmitting(true);
      try {
        if (editingId) {
          await updateMutation.mutateAsync({ id: editingId, data: value });
          addToast('exito', 'Categoria actualizada correctamente');
        } else {
          await createMutation.mutateAsync(value);
          addToast('exito', 'Categoria creada correctamente');
        }
        handleCloseForm();
      } catch (err) {
        addToast('error', (err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
  });
  const [showParentSelector, setShowParentSelector] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  // Load Cloudinary Upload Widget CDN script
  useEffect(() => {
    const scriptId = "cloudinary-upload-widget";
    if (document.getElementById(scriptId)) return;
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://upload-widget.cloudinary.com/global/all.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      const el = document.getElementById(scriptId);
      if (el) el.remove();
    };
  }, []);

  const abrirWidgetCloudinary = () => {
    const cloudinary = (window as unknown as Record<string, unknown>).cloudinary as Record<string, unknown> | undefined;
    if (!cloudinary || typeof cloudinary.createUploadWidget !== "function") {
      addToast("error", "El widget de Cloudinary no se ha cargado. Recargue la pagina.");
      return;
    }
    const widget = (cloudinary.createUploadWidget as Function)(
      {
        cloudName: "dqp5n999t",
        uploadPreset: "fs_default",
        multiple: true,
        maxFiles: 10,
      },
      (error: unknown, result: { event: string; info?: { secure_url: string; public_id: string } }) => {
        if (error) {
          addToast("error", "Error al subir imagen a Cloudinary");
          return;
        }
        if (result?.event === "success" && result.info) {
          const newUrl = result.info.secure_url;
          const newPublicId = result.info.public_id;
          const currentUrls = form.getFieldValue("imagen_url") ?? [];
          form.setFieldValue("imagen_url", [...currentUrls, newUrl]);
          setImagenPublicIds((prev) => [...prev, newPublicId]);
        }
      }
    );
    cloudinaryWidgetRef.current = widget;
    (widget as { open: () => void }).open();
  };

  const handleDeleteImagen = async (publicId: string) => {
    if (!confirm("Eliminar esta imagen?")) return;
    setUploadingImages(true);
    try {
      await uploadsApi.deleteImage(publicId);
      const idx = imagenPublicIds.indexOf(publicId);
      if (idx >= 0) {
        const currentUrls = form.getFieldValue("imagen_url") ?? [];
        const newUrls = [...currentUrls];
        newUrls.splice(idx, 1);
        form.setFieldValue("imagen_url", newUrls);
        setImagenPublicIds((prev) => prev.filter((id) => id !== publicId));
      }
      addToast("exito", "Imagen eliminada correctamente");
    } catch {
      addToast("error", "Error al eliminar la imagen");
    } finally {
      setUploadingImages(false);
    }
  };

  const handleEdit = (cat: { id: number; nombre: string; descripcion: string | null; parent_id: number | null; orden_display: number }) => {
    setEditingId(cat.id);
    setShowForm(true);
    form.reset({
      nombre: cat.nombre,
      descripcion: cat.descripcion ?? "",
      parent_id: cat.parent_id,
      orden_display: cat.orden_display,
    }, { keepDefaultValues: true });
    const findParent = (nodes: CategoriaTree[]): string => {
      for (const n of nodes) {
        if (n.id === cat.parent_id) return n.nombre;
        const found = findParent(n.subcategorias);
        if (found) return found;
      }
      return "";
    };
    setSelectedParentName(cat.parent_id !== null ? findParent(treeData) : "");
    setShowParentSelector(false);
  };

  const handleCreate = () => {
    setEditingId(null);
    setShowForm(true);
    form.reset({ nombre: "", descripcion: "", parent_id: null, orden_display: 0, imagen_url: [] });
    setSelectedParentName("");
    setShowParentSelector(false);
    setImagenPublicIds([]);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingId(null);
    form.reset({ nombre: "", descripcion: "", parent_id: null, orden_display: 0, imagen_url: [] });
    setSelectedParentName("");
    setImagenPublicIds([]);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminar esta categoria?")) return;
    try {
      await deleteMutation.mutateAsync(id);
      addToast('exito', 'Categoria eliminada correctamente');
    } catch (err) {
      const msg = err instanceof AxiosError && err.response?.data
        ? (err.response.data as { detail?: string }).detail ?? err.message
        : (err as Error).message;
      addToast('error', msg);
    }
  };

  const handleExport = () => {
    const flatForExport = flattenTree(treeData);
    exportToExcel(flatForExport.map(({ id, nombre, descripcion, parent_id, orden_display, depth }) => ({
      Codigo: id, nombre, descripcion: descripcion ?? "", "Categoria padre": parent_id ?? "", Orden: orden_display, profundidad: depth,
    })), "categorias");
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Categorias</h1>
      {isError && <div className="bg-red-100 text-red-700 p-2 mb-4 rounded">{(error as Error)?.message || "Error al cargar"}</div>}

      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <input type="text" placeholder="Filtrar por nombre..." value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border px-3 py-1 rounded" />

        <button onClick={handleCreate}
          className="bg-green-600 text-white px-4 py-1.5 rounded cursor-pointer hover:bg-green-700">+ Nueva</button>
        <button onClick={handleExport}
          className="bg-blue-600 text-white px-4 py-1.5 rounded cursor-pointer hover:bg-blue-700">Exportar Excel</button>
      </div>

      {showForm && (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="border p-4 mb-4 rounded bg-gray-50 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium">Nombre</label>
            <form.Field name="nombre" validators={{ onChange: required() }}>
              {(field) => (
                <input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  className="border px-2 py-1 rounded w-full"
                />
              )}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium">Descripcion</label>
            <form.Field name="descripcion">
              {(field) => (
                <input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  className="border px-2 py-1 rounded w-full"
                />
              )}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium">Es una subcategoria de:</label>
            <div className="flex gap-2">
              <input value={selectedParentName} readOnly className="border px-2 py-1 rounded flex-1" placeholder="Ninguna" />
              <button type="button" onClick={() => setShowParentSelector(true)}
                className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer hover:bg-blue-700">Seleccionar</button>
            </div>
          </div>

          <div className="col-span-2 border p-3 rounded bg-white">
            <h3 className="text-sm font-medium mb-2">Imagenes</h3>
            <ImageCarousel
              images={form.getFieldValue("imagen_url") ?? []}
              publicIds={imagenPublicIds}
              onDelete={handleDeleteImagen}
              readOnly={false}
            />
            <button
              type="button"
              onClick={abrirWidgetCloudinary}
              disabled={uploadingImages}
              className="mt-2 bg-blue-600 text-white px-3 py-1 rounded text-sm cursor-pointer disabled:opacity-50 hover:bg-blue-700"
            >
              {uploadingImages ? "Subiendo..." : "Subir imagenes"}
            </button>
          </div>

          <div className="col-span-2 flex gap-2 mt-2">
            <button type="submit" disabled={submitting} className={`px-4 py-1 rounded cursor-pointer ${submitting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
              {submitting ? "Guardando..." : editingId ? "Actualizar" : "Crear"}</button>
            <button type="button" onClick={handleCloseForm}
              className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer hover:bg-gray-500">Cancelar</button>
          </div>
        </form>
      )}

      {showParentSelector && (
        <ParentSelector
          treeData={treeData}
          currentId={editingId}
          onSelect={(id, name) => {
            form.setFieldValue('parent_id', id);
            setSelectedParentName(name);
            setShowParentSelector(false);
          }}
          onClose={() => setShowParentSelector(false)}
        />
      )}

      {/* ── Tree Table ── */}
      <div className="rounded-lg shadow border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-3 py-3 text-left font-semibold">Nombre</th>
                <th className="px-3 py-3 text-left font-semibold hidden md:table-cell">Descripcion</th>
                <th className="px-3 py-3 text-left font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Loading state */}
              {isLoading && (
                <tr>
                  <td colSpan={3} className="px-3 py-12 text-center text-gray-400">
                    Cargando categorias...
                  </td>
                </tr>
              )}

              {/* Error state (banner is above, but still show empty body) */}
              {!isLoading && isError && (
                <tr>
                  <td colSpan={3} className="px-3 py-12 text-center text-gray-400">
                    Error al cargar categorias
                  </td>
                </tr>
              )}

              {/* Empty state */}
              {!isLoading && !isError && filteredTree.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-12 text-center text-gray-400">
                    {filter.trim() ? "No hay categorias que coincidan con el filtro" : "No hay categorias"}
                  </td>
                </tr>
              )}

              {/* Tree rows */}
              {!isLoading && !isError && filteredTree.map((node) => (
                <CategoryTreeRow
                  key={node.id}
                  categoria={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleExpand}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer with item count */}
        {!isLoading && !isError && filteredTree.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200">
            <span className="text-xs text-gray-500">
              {filteredTree.length} {filteredTree.length === 1 ? "categoria visible" : "categorias visibles"}
            </span>
            {filter.trim() && (
              <span className="text-xs text-blue-600">Filtro activo: "{filter}"</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
