const btn = document.getElementById('btn');
const message = document.getElementById('message');

btn.addEventListener('click', () => {
  message.textContent = 'You clicked the button!';
});
