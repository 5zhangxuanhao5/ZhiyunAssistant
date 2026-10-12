import React from 'react';import{createRoot}from'react-dom/client';import App from './App';
class Boundary extends React.Component<{children:React.ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return{error:true}}render(){return this.state.error?<div className="welcome"><h1>界面遇到问题</h1><p>本机学习资料不会被删除。</p><button onClick={()=>location.reload()}>重新打开界面</button></div>:this.props.children}}
(window as any).__zhiyunFlush=()=>{const tasks:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('zhiyun-flush',{detail:{tasks}}));return Promise.all(tasks)};
createRoot(document.getElementById('root')!).render(<Boundary><App/></Boundary>);
