/**
 * AdminUsuariosPage — User management admin page (RBAC).
 * Uses TanStack Query for data fetching and mutations.
 * Uses DataTable with server-side pagination, SearchFilter, and Modal.
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { type Usuario, type UsuarioCreate, type UsuarioUpdate } from "@/features/auth/api/usuarios";
import { apiFetch, getUserRoles } from "@/shared/api/client";
import { useUsuarios, useCreateUsuario, useUpdateUsuario, useDeleteUsuario } from "@/features/auth/hooks/useUsuarios";
import { useAppForm, required, email, minLength, composeValidators } from "@/shared/hooks/useAppForm";
import { addToast } from "@/shared/components/Toast";
import DataTable, { type DataTableColumn } from "@/shared/components/DataTable";
import SearchFilter from "@/shared/components/SearchFilter";
import Modal from "@/shared/components/Modal";
import { usePagination } from "@/shared/hooks/usePagination";
import ErrorBanner from "@/shared/components/ErrorBanner";
import { EditButton, DeleteButton } from "@/shared/components/ActionButton";
import FormFooter from "@/shared/components/FormFooter";

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
  const [error, setError] = useState<string | null>(null);

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
    onSubmit: async ({ value }: { value: EditarForm }) => {
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
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        const msg = axiosErr?.response?.data?.detail ?? (err as Error).message ?? 'Error desconocido';
        setError(msg);
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
    <Modal
      open={true}
      onClose={onClose}
      title={`Editar Usuario #${usuario.id}`}
      footer={
        <FormFooter
          isSubmitting={guardando}
          isEditing={true}
          onCancel={onClose}
          updateLabel="Guardar"
          createLabel="Guardar"
          formId="edit-user-form"
        />
      }
    >
      <form id="edit-user-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="space-y-3">
        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
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
      </form>
    </Modal>
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
    onSubmit: async ({ value }: { value: CrearForm }) => {
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
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        const msg = axiosErr?.response?.data?.detail ?? (err as Error).message ?? 'Error desconocido';
        setError(msg);
      } finally {
        setGuardando(false);
      }
    },
  });

  const toggleRol = (codigo: string) => {
    setRolesSel((prev) => prev.includes(codigo) ? prev.filter((c) => c !== codigo) : [...prev, codigo]);
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Crear Usuario"
      footer={
        <FormFooter
          isSubmitting={guardando}
          isEditing={false}
          onCancel={onClose}
          createLabel="Crear usuario"
          submitLabel="Creando..."
          formId="create-user-form"
        />
      }
    >
      <form id="create-user-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="space-y-3">
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
      </form>
    </Modal>
  );
}

/* ── Pagina principal ── */

export default function AdminUsuariosPage() {
  const navigate = useNavigate();
  const [rolFiltro, setRolFiltro] = useState("");
  const [search, setSearch] = useState("");
  const [todosRoles, setTodosRoles] = useState<RolOption[]>([]);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [creando, setCreando] = useState(false);

  const { skip, limit, handlePageChange, handleLimitChange } = usePagination(DEFAULT_LIMIT);

  const userRoles = getUserRoles();
  const esAdmin = userRoles.includes("ADMIN");
  useEffect(() => {
    if (!esAdmin) navigate("/productos", { replace: true });
  }, [esAdmin, navigate]);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    handlePageChange(0);
  }, [handlePageChange]);

  // ── TanStack Query ──
  const { data, isLoading, isError, error } = useUsuarios(skip, limit, rolFiltro || undefined, search || undefined);
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

  const columns: DataTableColumn<Usuario>[] = [
    {
      key: "id" as const,
      label: "Codigo",
      hideOnMobile: true,
      render: (u) => <span className="text-gray-500 text-xs">#{u.id}</span>,
    },
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
          <EditButton onClick={() => setEditando(u)} />
          {u.roles.every((r) => r.codigo !== "ADMIN") && (
            <DeleteButton onClick={() => handleDelete(u.id)} />
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
      <ErrorBanner isError={isError} error={error} message="Error al cargar" />
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <SearchFilter onSearch={handleSearch} placeholder="Buscar por nombre, apellido o email..." />
        <label className="text-sm font-medium text-gray-700">Rol:</label>
        <select value={rolFiltro} onChange={(e) => { setRolFiltro(e.target.value); handlePageChange(0); }} className="border border-gray-300 rounded px-3 py-1.5 text-sm">
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
