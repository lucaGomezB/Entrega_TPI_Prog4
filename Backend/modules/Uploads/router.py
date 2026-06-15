"""
Uploads router — API endpoints for image upload and deletion.

Endpoints:
    POST /uploads/imagen            — Upload an image file (ADMIN only)
    DELETE /uploads/imagen/{public_id} — Delete an image by public ID (ADMIN only)
"""

from fastapi import APIRouter, Depends, UploadFile, File, status
from modules.IdentidadYAcceso.Auth.dependencies import require_roles
from .service import CloudinaryService
from .schemas import ImageUploadResponse

router = APIRouter(prefix="/uploads", tags=["Uploads"])


@router.post(
    "/imagen",
    response_model=ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(["ADMIN"]))],
)
def upload_imagen(file: UploadFile = File(...)):
    """POST /uploads/imagen — Upload an image file to Cloudinary. Requires ADMIN role."""
    return CloudinaryService.upload_image(file)


@router.delete(
    "/imagen/{public_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(["ADMIN"]))],
)
def delete_imagen(public_id: str):
    """DELETE /uploads/imagen/{public_id} — Delete an image from Cloudinary. Requires ADMIN role."""
    CloudinaryService.delete_image(public_id)
    return None
