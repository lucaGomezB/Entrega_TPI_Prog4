/**
 * CategoriasCRUD — Category management admin page.
 *
 * Features:
 *   - Hierarchical tree display via TanStack Query useCategoriasTree().
 *   - Expand/collapse tree nodes.
 *   - CRUD operations: create, edit, delete categories via mutations.
 *   - Parent category selection via a tree-based modal (prevents cycles).
 *   - Text filter that recursively filters the tree.
 *   - Excel export of the flattened (depth-annotated) tree.
 */

import { useEffect, useState, useRef } from "react";
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

function filterTree(nodes: CategoriaTree[], query: string): CategoriaTree[] {
  const lower = query.toLowerCase();
  return nodes.reduce<CategoriaTree[]>((acc, node) => {
    const matches = node.nombre.toLowerCase().includes(lower);
    const filteredChildren = filterTree(node.subcategorias, query);
    if (matches || filteredChildren.length > 0) {
      acc.push({
        ...node,
        subcategorias: matches ? node.subcategorias : filteredChildren,
      });
    }
    return acc;
  }, []);
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

/* ── Tree Row ── */

function CategoryTreeRow({
  categoria, depth, expanded, onToggle, onEdit, onDelete,
}: {
  categoria: CategoriaTree;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onEdit: (cat: CategoriaTree) => void;
  onDelete: (id: number) => void;
}) {
  const hasChildren = categoria.subcategorias.length > 0;
  const isExpanded = expanded.has(categoria.id);

  return (
    <>
      <tr className="hover:bg-gray-100 border-b">
        <td className="p-2" style={{ paddingLeft: `${12 + depth * 24}px` }}>
          <span className="inline-flex items-center gap-1">
            {hasChildren ? (
              <button
                onClick={() => onToggle(categoria.id)}
                className="border border-gray-400 bg-white text-gray-700 hover:bg-gray-100 text-xs w-5 h-5 flex items-center justify-center rounded-sm cursor-pointer select-none"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? "-" : "+"}
              </button>
            ) : (
              <span className="w-5 h-5 inline-block" />
            )}
            <span className="font-semibold text-gray-900">{categoria.nombre}</span>
          </span>
        </td>
        <td className="p-2 text-sm text-gray-600">{categoria.descripcion ?? "-"}</td>
        <td className="p-2">
          <div className="flex gap-1">
            <button onClick={() => onEdit(categoria)}
              className="bg-yellow-500 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-yellow-600">Editar</button>
            <button onClick={() => onDelete(categoria.id)}
              className="bg-red-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-red-700">Eliminar</button>
          </div>
        </td>
      </tr>
      {hasChildren && isExpanded && (
        categoria.subcategorias.map((child) => (
          <CategoryTreeRow
            key={child.id}
            categoria={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))
      )}
    </>
  );
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

  const renderTreeOptions = (nodes: CategoriaTree[], depth = 0): React.ReactNode[] => {
    const elements: React.ReactNode[] = [];
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

/* ── Main Page ── */

export default function CategoriasCRUD() {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedParentName, setSelectedParentName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Cloudinary Upload Widget state
  const cloudinaryWidgetRef = useRef<unknown>(null);
  const [imagenPublicIds, setImagenPublicIds] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  // ── TanStack Query ──
  const { data: treeData = [], isLoading, isError, error } = useCategoriasTree();
  const createMutation = useCreateCategoria();
  const updateMutation = useUpdateCategoria();
  const deleteMutation = useDeleteCategoria();

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

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEdit = (cat: CategoriaTree) => {
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
      addToast('error', (err as Error).message);
    }
  };

  const displayTree = filter ? filterTree(treeData, filter) : treeData;
  const flatForExport = flattenTree(displayTree);

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
        <button onClick={() => exportToExcel(flatForExport.map(({ id, nombre, descripcion, parent_id, orden_display, depth }) => ({
              Codigo: id, nombre, descripcion: descripcion ?? "", "Categoria padre": parent_id ?? "", Orden: orden_display, profundidad: depth,
            })), "categorias")}
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

      {isLoading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : (
        <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse border">
          <thead><tr className="bg-gray-200">
            <th className="border p-2 text-left">Nombre</th>
            <th className="border p-2 text-left">Descripcion</th>
            <th className="border p-2 text-left">Acciones</th>
          </tr></thead>
          <tbody>
            {displayTree.length === 0 ? (
              <tr><td colSpan={3} className="border p-2 text-center text-gray-500">Sin resultados</td></tr>
            ) : (
              displayTree.map((root) => (
                <CategoryTreeRow
                  key={root.id}
                  categoria={root}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleExpand}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
