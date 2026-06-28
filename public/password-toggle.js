document.addEventListener('DOMContentLoaded', () => {
  const passwordFields = document.querySelectorAll('input[type="password"]');

  passwordFields.forEach((field) => {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';

    field.parentNode.insertBefore(wrapper, field);
    wrapper.appendChild(field);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.textContent = 'Afficher';
    toggleButton.style.position = 'absolute';
    toggleButton.style.right = '10px';
    toggleButton.style.top = '50%';
    toggleButton.style.transform = 'translateY(-50%)';
    toggleButton.style.background = 'transparent';
    toggleButton.style.color = '#276ef1';
    toggleButton.style.border = 'none';
    toggleButton.style.padding = '0';
    toggleButton.style.fontWeight = '800';
    toggleButton.style.cursor = 'pointer';
    toggleButton.style.lineHeight = '1';
    toggleButton.style.display = 'flex';
    toggleButton.style.alignItems = 'center';
    toggleButton.style.justifyContent = 'center';

    wrapper.appendChild(toggleButton);

    let revealTimer = null;

    const revealForBriefly = () => {
      field.type = 'text';
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        field.type = 'password';
      }, 1200);
    };

    toggleButton.addEventListener('click', () => {
      const isVisible = field.type === 'text';
      field.type = isVisible ? 'password' : 'text';
      toggleButton.textContent = isVisible ? 'Afficher' : 'Masquer';
      if (!isVisible) {
        if (revealTimer) clearTimeout(revealTimer);
        revealTimer = setTimeout(() => {
          field.type = 'password';
          toggleButton.textContent = 'Afficher';
        }, 1200);
      }
    });

    field.addEventListener('input', () => {
      if (field.type === 'text') {
        if (revealTimer) clearTimeout(revealTimer);
        revealTimer = setTimeout(() => {
          field.type = 'password';
          toggleButton.textContent = 'Afficher';
        }, 1200);
      }
    });
  });
});
