from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.database import get_supabase

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    Validates the Supabase JWT from the Authorization header.
    Returns the Supabase user object or raises 401.
    """
    token = credentials.credentials
    db = get_supabase()
    try:
        response = db.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return response.user
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_admin(current_user=Depends(get_current_user)):
    """Dependency that additionally checks the user has admin role."""
    db = get_supabase()
    result = db.table("user_roles").select("role").eq(
        "user_id", str(current_user.id)
    ).execute()
    roles = [r["role"] for r in (result.data or [])]
    if "admin" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user
