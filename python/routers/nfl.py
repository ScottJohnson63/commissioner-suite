from __future__ import annotations

import nfl_data_py as nfl
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(tags=["nfl"])


@router.get("/players")
async def get_players() -> list[dict]:
    """Return a flat list of all known players."""
    try:
        df = nfl.import_players()
        return df.where(df.notna(), None).to_dict(orient="records")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/weekly")
async def get_weekly_stats(
    season: int = Query(..., description="NFL season year, e.g. 2024"),
    week: int | None = Query(None, ge=1, le=22, description="Optional week filter"),
) -> list[dict]:
    """Return weekly player stats for a given season (and optional week)."""
    try:
        df = nfl.import_weekly_data([season])
        if week is not None:
            df = df[df["week"] == week]
        return df.where(df.notna(), None).to_dict(orient="records")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/seasonal")
async def get_seasonal_stats(
    season: int = Query(..., description="NFL season year, e.g. 2024"),
) -> list[dict]:
    """Return season-level aggregated stats."""
    try:
        df = nfl.import_seasonal_data([season])
        return df.where(df.notna(), None).to_dict(orient="records")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/schedules")
async def get_schedules(
    season: int = Query(..., description="NFL season year"),
) -> list[dict]:
    """Return game schedules for a season."""
    try:
        df = nfl.import_schedules([season])
        return df.where(df.notna(), None).to_dict(orient="records")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc