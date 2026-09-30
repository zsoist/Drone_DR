"""Splatfacto with gsplat's MCMC densification and a hard Gaussian cap (W2).

Runs ONLY on the GPU PC, inside the splat env (nerfstudio 1.1.5 + gsplat 1.4.0):
nerfstudio's stock ``splatfacto`` hardcodes ``DefaultStrategy`` and exposes no
``strategy``/cap option, so this module adds a subclass that swaps in
``gsplat.MCMCStrategy`` and registers it as the ``splatfacto-mcmc`` method. It
does not modify the installed nerfstudio; the launcher mirrors ``ns-train``.

Recipe = gsplat ``examples/simple_trainer.py mcmc`` preset (init_opa 0.5,
init_scale 0.1, opacity_reg 0.01, scale_reg 0.01, noise_lr 5e5, min_opacity
0.005, 5% growth per refine step up to ``cap-max``) on top of splatfacto's own
data pipeline, losses and optimizers, so the only variable vs. the production
baseline is the densification strategy.

Usage (same argv as ``ns-train``; PYTHONPATH must contain this file's dir):
    python -c "import splatfacto_mcmc; splatfacto_mcmc.main()" splatfacto-mcmc --data ... \\
        --pipeline.model.cap-max 1000000 ... colmap --colmap-path sparse/0
The saved ``config.yml`` references this module, so ``ns-export`` and the eval
script need the same PYTHONPATH.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Type

import torch

from nerfstudio.models.splatfacto import SplatfactoModel, SplatfactoModelConfig

METHOD_NAME = "splatfacto-mcmc"


@dataclass
class SplatfactoMCMCModelConfig(SplatfactoModelConfig):
    """Splatfacto + MCMC strategy. Densify-only fields of the base config are ignored."""

    _target: Type = field(default_factory=lambda: SplatfactoMCMCModel)
    cap_max: int = 1_000_000
    """Hard upper bound on the number of Gaussians (MCMC grows 5% per refine step to it)."""
    noise_lr: float = 5e5
    mcmc_min_opacity: float = 0.005
    init_opacity: float = 0.5
    """MCMC starts every Gaussian at this opacity (default splatfacto: 0.1)."""
    init_scale: float = 0.1
    """Multiplier on the kNN initial scale (default splatfacto: 1.0)."""
    opacity_reg: float = 0.01
    scale_reg: float = 0.01
    sh_degree: int = 0
    """Production keeps SH0; raise it explicitly for experiments."""
    stop_split_at: int = 12500
    """MCMC refine stop step (gsplat: 25K of 30K); the base field is reused."""


class SplatfactoMCMCModel(SplatfactoModel):
    config: SplatfactoMCMCModelConfig

    def populate_modules(self):
        from gsplat.strategy import MCMCStrategy

        super().populate_modules()
        with torch.no_grad():
            self.gauss_params["opacities"].data.fill_(
                float(torch.logit(torch.tensor(float(self.config.init_opacity)))))
            self.gauss_params["scales"].data.add_(math.log(self.config.init_scale))
        self.strategy = MCMCStrategy(
            cap_max=int(self.config.cap_max),
            noise_lr=float(self.config.noise_lr),
            refine_start_iter=self.config.warmup_length,
            refine_stop_iter=self.config.stop_split_at,
            refine_every=self.config.refine_every,
            min_opacity=float(self.config.mcmc_min_opacity),
            verbose=True,
        )
        # get_outputs() reads strategy.absgrad; MCMC has no gradient-based growth.
        self.strategy.absgrad = False
        self.strategy_state = self.strategy.initialize_state()

    def step_post_backward(self, step):
        assert step == self.step
        self.strategy.step_post_backward(
            params=self.gauss_params,
            optimizers=self.optimizers,
            state=self.strategy_state,
            step=self.step,
            info=self.info,
            lr=self.optimizers["means"].param_groups[0]["lr"],
        )

    def get_loss_dict(self, outputs, batch, metrics_dict=None):
        loss = super().get_loss_dict(outputs, batch, metrics_dict)
        if self.training:
            loss["mcmc_opacity_reg"] = self.config.opacity_reg * torch.sigmoid(self.opacities).mean()
            loss["mcmc_scale_reg"] = self.config.scale_reg * torch.exp(self.scales).mean()
        return loss


def method_config():
    """Splatfacto's TrainerConfig with the MCMC model swapped in."""
    import dataclasses

    from nerfstudio.configs.method_configs import method_configs

    base = method_configs["splatfacto"]
    model = SplatfactoMCMCModelConfig()
    # carry over every shared field so the baseline recipe is inherited verbatim
    for f in dataclasses.fields(base.pipeline.model):
        if f.name not in ("_target",) and hasattr(model, f.name) and f.name not in (
                "sh_degree", "stop_split_at"):
            setattr(model, f.name, getattr(base.pipeline.model, f.name))
    pipeline = dataclasses.replace(base.pipeline, model=model)
    return dataclasses.replace(base, method_name=METHOD_NAME, pipeline=pipeline)


def register() -> None:
    """Make ``eval_setup``/``ns-export`` able to resolve the saved ``splatfacto-mcmc`` config."""
    from nerfstudio.configs.method_configs import all_methods

    all_methods.setdefault(METHOD_NAME, method_config())


def export() -> None:
    """``ns-export`` with the MCMC method registered (argv: gaussian-splat --load-config ...)."""
    register()
    from nerfstudio.scripts.exporter import entrypoint

    entrypoint()


def main() -> None:
    import tyro

    from nerfstudio.scripts.train import main as train_main

    union = tyro.conf.SuppressFixed[tyro.conf.FlagConversionOff[
        tyro.extras.subcommand_type_from_defaults({METHOD_NAME: method_config()})]]
    train_main(tyro.cli(union))


if __name__ == "__main__":
    main()
