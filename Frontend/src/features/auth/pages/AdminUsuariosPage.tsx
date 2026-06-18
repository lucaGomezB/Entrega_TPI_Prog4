/**
 * AdminUsuariosPage — User management admin page (RBAC).
 * Uses TanStack Query for data fetching and mutations.
 * Uses DataTable with server-side pagination.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type Usuario, type UsuarioCreate, type UsuarioUpdate } from "@/features/auth/api/usuarios";
import { apiFetch, getUserRoles } from "@/shared/api/client";
import { useUsuarios, useCreateUsuario, useUpdateUsuario, useDeleteUsuario } from "@/features/auth/hooks/useUsuarios";
import { useAppForm, required, email, minLength, composeValidators } from "@/shared/hooks/useAppForm";
import { addToast } from "@/shared/components/Toast";
import DataTable, { type DataTableColumn } from "@/shared/components/DataTable";

const DEFAULT_LIMIT = 10;

interface RolOption {
  codigo: string;
  nombre: string;
}

const coloresRol: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-800",
  STOCK: "bg-yellow-100 text-yellow-800",
  PEDIDOS: "bg-blue-100 text-blue-800",
  CLIENT: "bg-green-100 text-green-800",
};

/* ── Modal de edicion ── */

function EditarUsuarioModal({
  usuario,
  todosRoles,
  onClose,
  onSave,
}: {
  usuario: Usuario;
  todosRoles: RolOption[];
  onClose: () => void;
  onSave: (id: number, data: UsuarioUpdate) => Promise<void>;
}) {
  const [rolesSel, setRolesSel] = useState<string[]>(
    usuario.roles.map((r) => r.codigo)
  );
  const [guardando, setGuardando] = useState(false);

  interface EditarForm {
    nombre: string;
    apellido: string;
    email: string;
    celular: string;
  }

  const form = useAppForm<EditarForm>({
    defaultValues: {
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      celular: usuario.celular ?? "",
    },
    onSubmit: async ({ value }) => {
      setGuardando(true);
      try {
        await onSave(usuario.id, {
          nombre: value.nombre.trim(),
          apellido: value.apellido.trim(),
          email: value.email.trim(),
          celular: value.celular.trim() || null,
          roles_codigos: rolesSel,
        });
        onClose();
      } finally {
        setGuardando(false);
      }
    },
  });

  const toggleRol = (codigo: string) => {
    setRolesSel((prev) =>
      prev.includes(codigo)
        ? prev.filter((c) => c !== codigo)
        : [...prev, codigo]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Editar Usuario #{usuario.id}</h2>
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <form.Field name="nombre" validators={{ onChange: composeValidators(required()) }}>
                {(field) => (
                  <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                )}
              </form.Field>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Apellido</label>
              <form.Field name="apellido" validators={{ onChange: composeValidators(required()) }}>
                {(field) => (
                  <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                )}
              </form.Field>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <form.Field name="email" validators={{ onChange: composeValidators(required(), email()) }}>
              {(field) => (
                <input type="email" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              )}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Celular</label>
            <form.Field name="celular">
              {(field) => (
                <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              )}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Roles</label>
            <div className="flex flex-wrap gap-2">
              {todosRoles.map((rol) => (
                <button key={rol.codigo} type="button" onClick={() => toggleRol(rol.codigo)} className={`px-3 py-1 rounded text-sm border cursor-pointer transition-colors ${rolesSel.includes(rol.codigo) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}>
                  {rol.nombre}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer">Cancelar</button>
            <button type="submit" disabled={guardando} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer">{guardando ? "Guardando..." : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Modal de creacion ── */

function CrearUsuarioModal({
  todosRoles,
  onClose,
  onSave,
}: {
  todosRoles: RolOption[];
  onClose: () => void;
  onSave: (data: UsuarioCreate) => Promise<void>;
}) {
  const [rolesSel, setRolesSel] = useState<string[]>(["CLIENT"]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  interface CrearForm {
    nombre: string;
    apellido: string;
    email: string;
    celular: string;
    password: string;
    confirmPassword: string;
  }

  const form = useAppForm<CrearForm>({
    defaultValues: { nombre: "", apellido: "", email: "", celular: "", password: "", confirmPassword: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      if (value.password.length < 6) { setError("La contrasena debe tener al menos 6 caracteres"); return; }
      if (value.password !== value.confirmPassword) { setError("Las contrasenas no coinciden"); return; }
      setGuardando(true);
      try {
        await onSave({
          nombre: value.nombre.trim(),
          apellido: value.apellido.trim(),
          email: value.email.trim(),
          celular: value.celular.trim() || null,
          password: value.password,
          roles_codigos: rolesSel,
        });
        onClose();
      } finally {
        setGuardando(false);
      }
    },
  });

  const toggleRol = (codigo: string) => {
    setRolesSel((prev) => prev.includes(codigo) ? prev.filter((c) => c !== codigo) : [...prev, codigo]);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Crear Usuario</h2>
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="space-y-3">
          {error && <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <form.Field name="nombre" validators={{ onChange: composeValidators(required()) }}>
                {(field) => <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
              </form.Field>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Apellido</label>
              <form.Field name="apellido" validators={{ onChange: composeValidators(required()) }}>
                {(field) => <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
              </form.Field>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <form.Field name="email" validators={{ onChange: composeValidators(required(), email()) }}>
              {(field) => <input type="email" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Celular</label>
            <form.Field name="celular">
              {(field) => <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
            </form.Field>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Contrasena</label>
              <form.Field name="password" validators={{ onChange: composeValidators(required(), minLength(6)) }}>
                {(field) => <input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
              </form.Field>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contrasena</label>
              <form.Field name="confirmPassword" validators={{ onChange: composeValidators(required(), minLength(6)) }}>
                {(field) => <input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
              </form.Field>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Roles</label>
            <div className="flex flex-wrap gap-2">
              {todosRoles.map((rol) => (
                <button key={rol.codigo} type="button" onClick={() => toggleRol(rol.codigo)} className={`px-3 py-1 rounded text-sm border cursor-pointer transition-colors ${rolesSel.includes(rol.codigo) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}>{rol.nombre}</button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer">Cancelar</button>
            <button type="submit" disabled={guardando} className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 cursor-pointer">{guardando ? "Creando..." : "Crear usuario"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Pagina principal ── */

export default function AdminUsuariosPage() {
  const navigate = useNavigate();
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [rolFiltro, setRolFiltro] = useState("");
  const [todosRoles, setTodosRoles] = useState<RolOption[]>([]);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [creando, setCreando] = useState(false);

  const userRoles = getUserRoles();
  const esAdmin = userRoles.includes("ADMIN");
  useEffect(() => {
    if (!esAdmin) navigate("/productos", { replace: true });
  }, [esAdmin, navigate]);

  // ── TanStack Query ──
  const { data, isLoading, isError, error } = useUsuarios(skip, limit, rolFiltro || undefined);
  const usuarios = data?.items ?? [];
  const total = data?.total ?? 0;

  const createMutation = useCreateUsuario();
  const updateMutation = useUpdateUsuario();
  const deleteMutation = useDeleteUsuario();

  useEffect(() => {
    if (!esAdmin) return;
    apiFetch<RolOption[]>("/roles/").then(setTodosRoles).catch(() => {});
  }, [esAdmin]);

  const handleSave = async (id: number, data: UsuarioUpdate) => {
    await updateMutation.mutateAsync({ id, data });
    addToast('exito', "Usuario actualizado");
  };

  const handleCreate = async (data: UsuarioCreate) => {
    await createMutation.mutateAsync(data);
    addToast('exito', "Usuario creado exitosamente");
    setCreando(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Estas seguro de eliminar este usuario?")) return;
    try {
      await deleteMutation.mutateAsync(id);
      addToast('exito', "Usuario eliminado");
    } catch (e) {
      addToast('error', (e as Error).message);
    }
  };

  const handlePageChange = (newSkip: number) => setSkip(newSkip);
  const handleLimitChange = (newLimit: number) => { setLimit(newLimit); setSkip(0); };

  const columns: DataTableColumn<Usuario>[] = [
    {
      key: "nombre",
      label: "Nombre",
      render: (u) => `${u.nombre} ${u.apellido}`,
    },
    {
      key: "email",
      label: "Email",
      render: (u) => <span className="text-sm text-gray-600">{u.email}</span>,
    },
    {
      key: "roles",
      label: "Roles",
      render: (u) => (
        <div className="flex gap-1 flex-wrap">
          {u.roles.map((rol) => (
            <span key={rol.codigo} className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${coloresRol[rol.codigo] || "bg-gray-100 text-gray-800"}`}>
              {rol.nombre}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "acciones",
      label: "Acciones",
      render: (u) => (
        <div className="flex gap-1">
          <button onClick={() => setEditando(u)} className="bg-yellow-500 text-white px-3 py-1 rounded text-xs hover:bg-yellow-600 cursor-pointer">Editar</button>
          {u.roles.every((r) => r.codigo !== "ADMIN") && (
            <button onClick={() => handleDelete(u.id)} className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700 cursor-pointer">Eliminar</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Gestion de Usuarios</h1>
        <button onClick={() => setCreando(true)} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 cursor-pointer">+ Crear Usuario</button>
      </div>
      {isError && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4">{(error as Error)?.message || "Error al cargar"}</div>}
      <div className="flex gap-2 mb-4 items-center">
        <label className="text-sm font-medium text-gray-700">Filtrar por rol:</label>
        <select value={rolFiltro} onChange={(e) => { setRolFiltro(e.target.value); setSkip(0); }} className="border border-gray-300 rounded px-3 py-1.5 text-sm">
          <option value="">Todos los roles</option>
          {todosRoles.map((rol) => (<option key={rol.codigo} value={rol.codigo}>{rol.nombre}</option>))}
        </select>
      </div>
      <DataTable
        columns={columns}
        data={usuarios}
        total={total}
        skip={skip}
        limit={limit}
        onPageChange={handlePageChange}
        onLimitChange={handleLimitChange}
        isLoading={isLoading}
      />
      {creando && <CrearUsuarioModal todosRoles={todosRoles} onClose={() => setCreando(false)} onSave={handleCreate} />}
      {editando && <EditarUsuarioModal usuario={editando} todosRoles={todosRoles} onClose={() => setEditando(null)} onSave={handleSave} />}
    </div>
  );
}
