#!/bin/bash
# =============================================================================
# start.sh — RunPod pod entrypoint for the aitk-trainer image
# =============================================================================
#
# RunPod injects the user's public key as $PUBLIC_KEY. We authorize it, generate host
# keys, start sshd, then idle — SecurePodClient SSHes in (_waitForSshd) and launches
# aitktrainer.py over that connection (_bootstrapDetached). Lifted from ai-toolkit's
# upstream docker/start.sh setup_ssh(), which mirrors RunPod's container-template:
#   https://github.com/runpod/containers/blob/main/container-template/start.sh
# =============================================================================
set -e

setup_ssh() {
    if [[ $PUBLIC_KEY ]]; then
        echo "Setting up SSH..."
        mkdir -p ~/.ssh
        echo "$PUBLIC_KEY" >> ~/.ssh/authorized_keys
        chmod 700 -R ~/.ssh
        [ -f /etc/ssh/ssh_host_rsa_key ]     || ssh-keygen -t rsa     -f /etc/ssh/ssh_host_rsa_key     -q -N ''
        [ -f /etc/ssh/ssh_host_ecdsa_key ]   || ssh-keygen -t ecdsa   -f /etc/ssh/ssh_host_ecdsa_key   -q -N ''
        [ -f /etc/ssh/ssh_host_ed25519_key ] || ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -q -N ''
        # sshd needs the privilege-separation dir; root login with a key, no passwords.
        mkdir -p /run/sshd
        sed -i 's/#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
        service ssh start || /usr/sbin/sshd
        echo "sshd started."
    else
        echo "WARNING: no \$PUBLIC_KEY — sshd not started (SecurePodClient cannot connect)."
    fi
}

# Surface RUNPOD_* / PATH to non-login shells (matches upstream), so an SSH exec sees the env.
export_env_vars() {
    printenv | grep -E '^RUNPOD_|^PATH=|^HF_|^_=' | awk -F = '{ print "export " $1 "=\"" $2 "\"" }' >> /etc/rp_environment
    grep -q 'source /etc/rp_environment' ~/.bashrc || echo 'source /etc/rp_environment' >> ~/.bashrc
}

setup_ssh
export_env_vars

echo "aitk-trainer ready — idling for SSH-driven training jobs."
sleep infinity
